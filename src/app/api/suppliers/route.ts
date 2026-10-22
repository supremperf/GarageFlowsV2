export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { parsePoLinesJson } from '@/lib/money-json'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { logAudit } from '@/lib/audit'
import { transition } from '@/lib/suppliers/order'
import type { OrderStatus } from '@/lib/suppliers/types'
import { MOVEMENT } from '@/lib/stock/invoice-stock'

const KNOWN_STATUSES: OrderStatus[] = ['draft', 'sent', 'confirmed', 'received', 'cancelled', 'returned']

/** No live supplier adapter exists; never turn local cost data into a quote/order. */
const SUPPLIER_INTEGRATION_UNAVAILABLE = {
  error: 'SUPPLIER_INTEGRATION_REQUIRED',
  message: 'Aucune intégration fournisseur en temps réel n’est configurée. Les prix, disponibilités et délais ne peuvent pas être vérifiés. Aucune commande automatique n’est créée.',
}

// GET /api/suppliers — deliberately fail closed until a real supplier adapter is configured.
export const GET = withAuth(async () => {
  await requireSession()
  return NextResponse.json(SUPPLIER_INTEGRATION_UNAVAILABLE, { status: 501 })
})

// ── POST: create an automatic order (disabled) or advance a saved order ───────
const CreateSchema = z.object({
  action: z.literal('create-orders'),
  confirm: z.boolean().optional(),
})

const TransitionSchema = z.object({
  action: z.literal('transition'),
  confirm: z.boolean().optional(),
  orderId: z.string().min(1),
  to: z.enum(['sent', 'confirmed', 'received', 'cancelled', 'returned']),
})

const BodySchema = z.discriminatedUnion('action', [CreateSchema, TransitionSchema])

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'stock:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const garageId = session.user.garageId

  const rl = await enforceRateLimit('api', `suppliers:${garageId}`, { max: 30, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide', details: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data

  if (body.action === 'create-orders') {
    return NextResponse.json(SUPPLIER_INTEGRATION_UNAVAILABLE, { status: 501 })
  }

  // ── action === 'transition' ──────────────────────────────────────────────────
  const order = await prisma.purchaseOrder.findFirst({ where: { id: body.orderId, garageId }, select: { id: true, number: true, status: true, linesJson: true } })
  if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })

  const from = order.status as OrderStatus
  if (!KNOWN_STATUSES.includes(from)) {
    return NextResponse.json({ error: `État courant « ${order.status} » non géré.` }, { status: 409 })
  }

  const t = transition(from, body.to)
  if (!t.ok) return NextResponse.json({ error: t.error, from, to: body.to }, { status: 400 })

  if (!body.confirm) {
    return NextResponse.json({ confirmationRequired: true, order: { id: order.id, number: order.number, status: from }, to: body.to, effects: t.effects })
  }

  // The receipt/return paths alter stock, so malformed, empty, fractional or
  // non-positive lines must fail before any terminal status can be committed.
  let stockLines: Array<{ partId: string; qty: number }> = []
  let stockPartIds: string[] = []
  if (t.effects.incrementStock || t.effects.decrementStock) {
    let exactLines: ReturnType<typeof parsePoLinesJson>['lines']
    try {
      exactLines = parsePoLinesJson(order.linesJson).lines
    } catch {
      return NextResponse.json({ error: 'Lignes du bon de commande invalides ; corrigez-les avant cette transition.', code: 'INVALID_PURCHASE_ORDER_LINES' }, { status: 409 })
    }
    if (!exactLines.length || exactLines.some((line) =>
      !line.partName.trim() || fromScaled(line.qtyTenThousandths) <= 0
    )) {
      return NextResponse.json({ error: 'Le bon ne contient aucune ligne exploitable ; corrigez-le avant cette transition.', code: 'INVALID_PURCHASE_ORDER_LINES' }, { status: 409 })
    }
    const fractional = exactLines.filter((line) => !Number.isInteger(fromScaled(line.qtyTenThousandths)))
    if (fractional.length) {
      return NextResponse.json({ error: 'Le stock se compte en unités entières ; corrigez les quantités fractionnaires avant cette transition.', code: 'INVALID_STOCK_QUANTITY' }, { status: 409 })
    }
    stockLines = exactLines.flatMap((line) => line.partId
      ? [{ partId: line.partId, qty: fromScaled(line.qtyTenThousandths) }]
      : [])
    stockPartIds = [...new Set(stockLines.map((line) => line.partId))]
  }

  let result: { raced: boolean; unavailableParts: boolean; stockUpdated: number }
  try {
    result = await prisma.$transaction(async (tx) => {
      if (stockPartIds.length) {
        const ownedParts = await tx.part.findMany({
          where: { id: { in: stockPartIds }, garageId },
          select: { id: true },
        })
        if (ownedParts.length !== stockPartIds.length) {
          return { raced: false, unavailableParts: true, stockUpdated: 0 }
        }
      }

      // The status flip is the concurrency guard: only the request that actually
      // changes the row applies stock side effects.
      const claim = await tx.purchaseOrder.updateMany({
        where: { id: order.id, garageId, status: from },
        data: {
          status: body.to,
          ...(t.effects.stampSent ? { sentAt: new Date() } : {}),
          ...(t.effects.stampReceived ? { receivedAt: new Date() } : {}),
        },
      })
      if (claim.count === 0) return { raced: true, unavailableParts: false, stockUpdated: 0 }

      const journaliser = (partId: string, delta: number) =>
        tx.stockMovement.create({
          data: {
            garageId, partId, type: MOVEMENT.ADJUST, quantityDelta: delta,
            reason: `Commande fournisseur ${order.number} — ${from} → ${body.to}`,
          },
        })

      let stockUpdated = 0
      if (t.effects.incrementStock) {
        for (const line of stockLines) {
          const inc = await tx.part.updateMany({
            where: { id: line.partId, garageId },
            data: { quantity: { increment: line.qty } },
          })
          if (inc.count !== 1) throw new SupplierTransitionError('Une pièce liée au bon n’est plus disponible. Aucune transition n’a été appliquée.')
          await journaliser(line.partId, line.qty)
          stockUpdated++
        }
      } else if (t.effects.decrementStock) {
        for (const line of stockLines) {
          const dec = await tx.part.updateMany({
            where: { id: line.partId, garageId, quantity: { gte: line.qty } },
            data: { quantity: { decrement: line.qty } },
          })
          if (dec.count === 1) {
            await journaliser(line.partId, -line.qty)
            stockUpdated++
            continue
          }
          // Stock insuffisant : plafonner à zéro, mais seulement si la quantité
          // observée n’a pas changé. Une course est refusée au lieu d’un faux journal.
          const before = await tx.part.findFirst({ where: { id: line.partId, garageId }, select: { quantity: true } })
          if (!before) throw new SupplierTransitionError('Une pièce liée au bon n’est plus disponible. Aucune transition n’a été appliquée.')
          if (before.quantity >= line.qty) throw new SupplierTransitionError('Le stock a changé pendant le retour. Réessayez après vérification.')
          if (before.quantity === 0) continue
          const clamp = await tx.part.updateMany({
            where: { id: line.partId, garageId, quantity: before.quantity },
            data: { quantity: 0 },
          })
          if (clamp.count !== 1) throw new SupplierTransitionError('Le stock a changé pendant le retour. Réessayez après vérification.')
          await journaliser(line.partId, -before.quantity)
          stockUpdated++
        }
      }
      return { raced: false, unavailableParts: false, stockUpdated }
    })
  } catch (error) {
    if (error instanceof SupplierTransitionError) {
      return NextResponse.json({ error: error.message, code: 'PURCHASE_ORDER_STOCK_CONFLICT' }, { status: 409 })
    }
    throw error
  }

  if (result.unavailableParts) {
    return NextResponse.json({ error: 'Une pièce liée au bon est introuvable dans ce garage. Corrigez les lignes avant réception ou retour.', code: 'PURCHASE_ORDER_PART_UNAVAILABLE' }, { status: 409 })
  }

  if (result.raced) {
    return NextResponse.json({ error: 'La commande a déjà changé d\'état.' }, { status: 409 })
  }

  await logAudit({ action: 'update', entityType: 'PurchaseOrder', entityId: order.id, session, req, details: { from, to: body.to } })
  return NextResponse.json({ ok: true, order: { id: order.id, number: order.number, status: body.to }, effects: t.effects, stockUpdated: result.stockUpdated })
})

class SupplierTransitionError extends Error {}

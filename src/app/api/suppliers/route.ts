export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { logAudit } from '@/lib/audit'
import {
  SupplierEngine,
  StaticConnector,
  transition,
  type CatalogEntry,
  type OrderStatus,
  type PartQuery,
  type SupplierConnector,
} from '@/lib/suppliers'

// Assumed lead time (days) for a garage's habitual supplier when unknown, and the
// sentinel "available to order" quantity for a catalogue we don't hold stock for.
const DEFAULT_LEAD_TIME_DAYS = 5
const ASSUMED_AVAILABLE = 100_000

const KNOWN_STATUSES: OrderStatus[] = ['draft', 'sent', 'confirmed', 'received', 'cancelled', 'returned']

interface PartRow {
  id: string
  name: string
  reference: string | null
  supplierName: string | null
  supplierRef: string | null
  unitCost: number
  quantity: number
  minQuantity: number
}

/** Build one StaticConnector per known supplier from the garage's part catalogue. */
function connectorsFromParts(parts: PartRow[]): SupplierConnector[] {
  const bySupplier = new Map<string, CatalogEntry[]>()
  for (const p of parts) {
    const supplier = p.supplierName?.trim()
    if (!supplier) continue
    const list = bySupplier.get(supplier) ?? []
    list.push({
      reference: p.reference,
      name: p.name,
      supplierRef: p.supplierRef,
      unitPrice: p.unitCost,
      availableQty: ASSUMED_AVAILABLE,
      leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
      note: 'Fournisseur habituel',
    })
    bySupplier.set(supplier, list)
  }
  return Array.from(bySupplier.entries()).map(
    ([name, catalog], i) => new StaticConnector({ id: `sup-${i}`, name, catalog }),
  )
}

/** Reorder queries for parts at/below their low-stock threshold. */
function lowStockQueries(parts: PartRow[], targetMultiplier: number): PartQuery[] {
  const queries: PartQuery[] = []
  for (const p of parts) {
    if (p.quantity > p.minQuantity) continue
    const target = Math.max(p.minQuantity * targetMultiplier, p.minQuantity + 1)
    const need = Math.max(target - p.quantity, 1)
    queries.push({ partId: p.id, name: p.name, reference: p.reference, quantity: need, supplierRef: p.supplierRef })
  }
  return queries
}

async function loadParts(garageId: string): Promise<PartRow[]> {
  return prisma.part.findMany({
    where: { garageId },
    select: { id: true, name: true, reference: true, supplierName: true, supplierRef: true, unitCost: true, quantity: true, minQuantity: true },
    take: 5000,
  })
}

// ── GET: preview the automatic reorder plan (read-only, no writes) ─────────────
// GET /api/suppliers?targetMultiplier=2
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const targetMultiplier = Math.min(10, Math.max(1, Number(searchParams.get('targetMultiplier') ?? '2')))

  const parts = await loadParts(garageId)
  const queries = lowStockQueries(parts, targetMultiplier)
  const engine = new SupplierEngine(connectorsFromParts(parts))
  const { plan, errors } = await engine.quote(queries)

  return NextResponse.json({ ...plan, errors, scope: { targetMultiplier, lowStockParts: queries.length } })
})

// ── POST: create grouped draft orders, or advance an order's lifecycle ─────────
// Every impactful action is confirmation-gated: without `confirm: true` the
// endpoint returns a preview and `confirmationRequired: true` — it never writes.
const CreateSchema = z.object({
  action: z.literal('create-orders'),
  confirm: z.boolean().optional(),
  targetMultiplier: z.number().min(1).max(10).optional(),
  parts: z.array(z.object({ partId: z.string().min(1), quantity: z.number().int().positive() })).max(500).optional(),
})

const TransitionSchema = z.object({
  action: z.literal('transition'),
  confirm: z.boolean().optional(),
  orderId: z.string().min(1),
  to: z.enum(['sent', 'confirmed', 'received', 'cancelled', 'returned']),
})

const BodySchema = z.discriminatedUnion('action', [CreateSchema, TransitionSchema])

interface POLine {
  partId?: string | null
  partName: string
  reference?: string | null
  qty: number
  unitCost: number
}

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const rl = await enforceRateLimit('api', `suppliers:${garageId}`, { max: 30, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide', details: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data

  if (body.action === 'create-orders') {
    const parts = await loadParts(garageId)
    let queries: PartQuery[]
    if (body.parts?.length) {
      const byId = new Map(parts.map((p) => [p.id, p]))
      queries = body.parts.flatMap(({ partId, quantity }) => {
        const p = byId.get(partId)
        return p ? [{ partId: p.id, name: p.name, reference: p.reference, quantity, supplierRef: p.supplierRef }] : []
      })
    } else {
      queries = lowStockQueries(parts, body.targetMultiplier ?? 2)
    }

    const engine = new SupplierEngine(connectorsFromParts(parts))
    const { plan, errors } = await engine.quote(queries)

    // Preview unless explicitly confirmed.
    if (!body.confirm) {
      return NextResponse.json({ confirmationRequired: true, preview: plan, errors })
    }
    if (plan.orders.length === 0) {
      return NextResponse.json({ error: 'Aucune commande à créer.', unfulfillable: plan.unfulfillable }, { status: 400 })
    }

    // Persist one draft PurchaseOrder per supplier. Each order takes its own
    // number via a transactional counter increment, so concurrent runs never
    // collide on the unique (garageId, number) constraint.
    const created: { id: string; number: string; supplierName: string; totalHT: number }[] = []
    for (const order of plan.orders) {
      const lines: POLine[] = order.lines.map((l) => ({
        partId: l.partId,
        partName: l.name,
        reference: l.reference ?? null,
        qty: l.quantity,
        unitCost: l.unitPrice,
      }))
      const po = await prisma.$transaction(async (tx) => {
        const garage = await tx.garage.update({ where: { id: garageId }, data: { purchaseOrderCounter: { increment: 1 } } })
        const year = new Date().getFullYear()
        const number = `${garage.purchaseOrderPrefix}-${year}-${String(garage.purchaseOrderCounter).padStart(3, '0')}`
        return tx.purchaseOrder.create({
          data: {
            number,
            garageId,
            supplierName: order.supplierName,
            linesJson: JSON.stringify(lines),
            totalHT: order.totalHT,
            status: 'draft',
            notes: `Commande auto — ${order.lines.length} référence(s), livraison ~${order.maxLeadTimeDays} j.`,
          },
        })
      })
      created.push({ id: po.id, number: po.number, supplierName: po.supplierName ?? '—', totalHT: po.totalHT })
      await logAudit({ action: 'create', entityType: 'PurchaseOrder', entityId: po.id, session, req, details: { auto: true, supplier: po.supplierName, totalHT: po.totalHT } })
    }

    return NextResponse.json({ created, unfulfillable: plan.unfulfillable }, { status: 201 })
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

  let lines: POLine[] = []
  try { lines = JSON.parse(order.linesJson) } catch { lines = [] }
  const stockLines = lines.filter((l): l is POLine & { partId: string } => !!l.partId && l.qty > 0)

  const result = await prisma.$transaction(async (tx) => {
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
    if (claim.count === 0) return { raced: true }

    if (t.effects.incrementStock) {
      for (const l of stockLines) {
        const part = await tx.part.findFirst({ where: { id: l.partId, garageId }, select: { id: true } })
        if (part) await tx.part.update({ where: { id: l.partId }, data: { quantity: { increment: l.qty } } })
      }
    } else if (t.effects.decrementStock) {
      for (const l of stockLines) {
        // ATOMICITÉ + PLANCHER À ZÉRO : décrément atomique conditionnel (jamais de
        // read-modify-write qui perdrait une écriture concurrente ; jamais de stock
        // NÉGATIF). Si le stock présent est insuffisant (des unités ont déjà été
        // consommées ailleurs), on plafonne à 0 — on ne peut pas retirer plus que
        // ce qui est présent. `updateMany … where garageId` garde le scoping tenant.
        const dec = await tx.part.updateMany({
          where: { id: l.partId, garageId, quantity: { gte: l.qty } },
          data:  { quantity: { decrement: l.qty } },
        })
        if (dec.count === 0) {
          await tx.part.updateMany({ where: { id: l.partId, garageId, quantity: { lt: l.qty } }, data: { quantity: 0 } })
        }
      }
    }
    return { raced: false }
  })

  if (result.raced) {
    return NextResponse.json({ error: 'La commande a déjà changé d\'état.' }, { status: 409 })
  }

  await logAudit({ action: 'update', entityType: 'PurchaseOrder', entityId: order.id, session, req, details: { from, to: body.to } })
  return NextResponse.json({ ok: true, order: { id: order.id, number: order.number, status: body.to }, effects: t.effects })
})

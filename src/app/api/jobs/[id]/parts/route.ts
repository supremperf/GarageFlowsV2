export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'

/** Quantité maximale acceptée pour une ligne de pièce (garde-fou anti-abus). */
const MAX_QTY = 100_000

/**
 * Valide une quantité entière strictement positive et raisonnable.
 * Refuse null / '' / NaN / Infinity / négatif / zéro / non-entier / excessif.
 */
function parseQuantity(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (!Number.isInteger(n)) return null
  if (n <= 0) return null
  if (n > MAX_QTY) return null
  return n
}

/** Erreur métier portant un statut HTTP, propagée hors transaction. */
class StockError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// GET /api/jobs/:id/parts
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const job = await prisma.job.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const parts = await prisma.jobPart.findMany({
    where: { jobId: params.id },
    include: { part: true },
  })
  return NextResponse.json(parts)
})

// POST /api/jobs/:id/parts — ajoute une pièce à l'intervention (ou augmente la ligne)
export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session  = await requireSession()
  const garageId = session.user.garageId

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 })
  }
  const { partId } = body as { partId?: string }
  if (!partId || typeof partId !== 'string') {
    return NextResponse.json({ error: 'partId requis' }, { status: 400 })
  }
  // Quantité ABSENTE → défaut 1 ; toute valeur explicite (y compris null/'')
  // est validée strictement.
  const rawQty = (body as { quantity?: unknown }).quantity
  const qty = rawQty === undefined ? 1 : parseQuantity(rawQty)
  if (qty === null) {
    return NextResponse.json({ error: 'Quantité invalide (entier > 0 requis)' }, { status: 400 })
  }

  try {
    const jobPart = await prisma.$transaction(async (tx) => {
      // 1. Intervention appartient au garage authentifié.
      const job = await tx.job.findFirst({ where: { id: params.id, garageId } })
      if (!job) throw new StockError(404, 'Intervention introuvable')

      // 2. Pièce appartient au garage + est disponible.
      const part = await tx.part.findFirst({ where: { id: partId, garageId } })
      if (!part) throw new StockError(404, 'Pièce introuvable')

      // 3. Décrément ATOMIQUE et conditionnel : ne consomme le stock que s'il est
      //    suffisant. Empêche le stock négatif ET les courses concurrentes
      //    (deux requêtes ne peuvent pas consommer la même unité).
      const dec = await tx.part.updateMany({
        where: { id: partId, garageId, quantity: { gte: qty } },
        data:  { quantity: { decrement: qty } },
      })
      if (dec.count !== 1) {
        throw new StockError(409, 'Stock insuffisant pour cette pièce')
      }

      // 4. Crée la ligne ou augmente la ligne existante (le stock a déjà été
      //    déduit du supplément exact ci-dessus — plus de fuite de stock).
      const existing = await tx.jobPart.findFirst({ where: { jobId: params.id, partId } })
      if (existing) {
        return tx.jobPart.update({
          where: { id: existing.id },
          data:  { quantity: existing.quantity + qty },
          include: { part: true },
        })
      }
      return tx.jobPart.create({
        data: {
          jobId:     params.id,
          partId,
          quantity:  qty,
          unitPrice: part.unitPrice,
          unitCost:  part.unitCost,
        },
        include: { part: true },
      })
    })

    await logAudit({
      action: 'update', entityType: 'Part', entityId: partId, session, req,
      details: { op: 'job-part-add', jobId: params.id, quantity: qty },
    })
    return NextResponse.json(jobPart, { status: 201 })
  } catch (e) {
    if (e instanceof StockError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }
})

// DELETE /api/jobs/:id/parts  body: { jobPartId } — retire la ligne + restitue le stock
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session  = await requireSession()
  const garageId = session.user.garageId

  const body = await req.json().catch(() => null)
  const jobPartId = body && typeof body === 'object' ? (body as { jobPartId?: string }).jobPartId : undefined
  if (!jobPartId || typeof jobPartId !== 'string') {
    return NextResponse.json({ error: 'jobPartId requis' }, { status: 400 })
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Ligne appartenant à une intervention du garage authentifié (anti-IDOR).
      const jobPart = await tx.jobPart.findFirst({
        where: { id: jobPartId, jobId: params.id, job: { garageId } },
      })
      if (!jobPart) throw new StockError(404, 'Ligne introuvable')

      // Restitue EXACTEMENT la quantité au stock, scoping garage.
      await tx.part.updateMany({
        where: { id: jobPart.partId, garageId },
        data:  { quantity: { increment: jobPart.quantity } },
      })
      await tx.jobPart.delete({ where: { id: jobPart.id } })
    })

    await logAudit({
      action: 'update', entityType: 'Part', entityId: jobPartId, session, req,
      details: { op: 'job-part-remove', jobId: params.id },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof StockError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }
})

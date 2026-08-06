export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { computeTotals as computeMoneyTotals, type MoneyLine } from '@/lib/money'

interface WorkLine {
  description: string
  durationMin: number
  unitPrice: number
  laborOpId?: string
}

interface PartLine {
  name: string
  reference?: string
  qty: number
  unitPrice: number
}

/**
 * Totaux exacts (centimes entiers via lib/money.ts) ; renvoie aussi les centimes
 * (source de vérité stockée). Returns null when worksJson/partsJson are invalid.
 */
function computeTotals(
  worksJson: string,
  partsJson: string,
  taxRate: number,
): { totalHT: number; totalTTC: number; totalHtCents: number; totalTtcCents: number } | null {
  let works: WorkLine[]
  let parts: PartLine[]
  try {
    works = JSON.parse(worksJson)
    parts = JSON.parse(partsJson)
  } catch {
    return null
  }
  if (!Array.isArray(works) || !Array.isArray(parts)) return null
  const lines: MoneyLine[] = [
    ...works.map((w) => ({ quantity: 1, unitPrice: Number(w.unitPrice) || 0 })),
    ...parts.map((p) => ({ quantity: Number(p.qty) || 0, unitPrice: Number(p.unitPrice) || 0 })),
  ]
  const t = computeMoneyTotals(lines, Number(taxRate) || 0)
  return { totalHT: t.totalHT, totalTTC: t.totalTTC, totalHtCents: t.totalHTCents, totalTtcCents: t.totalTTCCents }
}

// GET /api/work-orders/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
  })
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(wo)
})

// PATCH /api/work-orders/[id]
export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Resolve current JSON strings for recompute
  const worksJson = body.worksJson !== undefined
    ? (typeof body.worksJson === 'string' ? body.worksJson : JSON.stringify(body.worksJson))
    : existing.worksJson
  const partsJson = body.partsJson !== undefined
    ? (typeof body.partsJson === 'string' ? body.partsJson : JSON.stringify(body.partsJson))
    : existing.partsJson
  const taxRate = body.taxRate !== undefined ? body.taxRate : existing.taxRate

  const totals = computeTotals(worksJson, partsJson, taxRate)
  if (!totals) {
    return NextResponse.json({ error: 'worksJson/partsJson invalides' }, { status: 400 })
  }
  const { totalHT, totalTTC, totalHtCents, totalTtcCents } = totals

  // Centimes = source de vérité ; totalHT/totalTTC = miroir dérivé (fromCents).
  const updateData: Record<string, unknown> = { worksJson, partsJson, taxRate, totalHT, totalTTC, totalHtCents, totalTtcCents }

  if (body.status !== undefined) updateData.status = body.status
  if (body.clientName !== undefined) updateData.clientName = body.clientName
  if (body.clientPhone !== undefined) updateData.clientPhone = body.clientPhone
  if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail
  if (body.clientAddress !== undefined) updateData.clientAddress = body.clientAddress
  if (body.vehicleMake !== undefined) updateData.vehicleMake = body.vehicleMake
  if (body.vehicleModel !== undefined) updateData.vehicleModel = body.vehicleModel
  if (body.licensePlate !== undefined) updateData.licensePlate = body.licensePlate
  if (body.mileage !== undefined) updateData.mileage = body.mileage
  if (body.vin !== undefined) updateData.vin = body.vin
  if (body.mechanicId !== undefined) {
    // Validate the mechanic belongs to this garage before cross-linking.
    if (body.mechanicId !== null) {
      const mech = await prisma.mechanic.findFirst({
        where: { id: body.mechanicId, garageId: session.user.garageId },
      })
      if (!mech) return NextResponse.json({ error: 'mechanicId invalide' }, { status: 400 })
    }
    updateData.mechanicId = body.mechanicId
  }
  if (body.notes !== undefined) updateData.notes = body.notes

  // SECURITY (IDOR): un mécanicien réassigné doit appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'mechanic', id: body.mechanicId, label: 'Mécanicien' },
  ])
  if (relErr) return relErr

  // Atomique (anti-TOCTOU) : la portée garageId est dans le where.
  const res = await prisma.workOrder.updateMany({
    where: { id: params.id, garageId: session.user.garageId },
    data: updateData,
  })
  if (res.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
  })
  return NextResponse.json(wo)
})

// DELETE /api/work-orders/[id]
export const DELETE = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Seuls les ordres en brouillon peuvent être supprimés' }, { status: 400 })
  }
  await prisma.workOrder.deleteMany({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})

export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { computeTotals as computeMoneyTotals } from '@/lib/money'

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

/** Returns null when worksJson/partsJson are not valid JSON arrays. */
function computeTotals(worksJson: string, partsJson: string, taxRate: number): { totalHT: number; totalTTC: number } | null {
  let works: WorkLine[]
  let parts: PartLine[]
  try {
    works = JSON.parse(worksJson)
    parts = JSON.parse(partsJson)
  } catch {
    return null
  }
  if (!Array.isArray(works) || !Array.isArray(parts)) return null
  // Exactitude financière : délègue à src/lib/money.ts (arithmétique en centimes
  // entiers). L'ancien calcul flottant (reduce + Math.round final) pouvait
  // accumuler du bruit binaire et rompre l'invariant totalTTC = totalHT + TVA.
  const lines = [
    ...works.map((w) => ({ quantity: 1, unitPrice: Number(w.unitPrice) || 0 })),
    ...parts.map((p) => ({ quantity: Number(p.qty) || 0, unitPrice: Number(p.unitPrice) || 0 })),
  ]
  const totals = computeMoneyTotals(lines, Number(taxRate) || 0)
  return { totalHT: totals.totalHT, totalTTC: totals.totalTTC }
}

// GET /api/work-orders
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const jobId = searchParams.get('jobId')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (status) where.status = status
  if (jobId) where.jobId = jobId

  const orders = await prisma.workOrder.findMany({
    where,
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(orders)
})

// POST /api/work-orders
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.clientName) {
    return NextResponse.json({ error: 'clientName est requis' }, { status: 400 })
  }

  // SECURITY (IDOR): job & mécanicien assignés doivent appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'job', id: body.jobId, label: 'Intervention' },
    { model: 'mechanic', id: body.mechanicId, label: 'Mécanicien' },
  ])
  if (relErr) return relErr

  const worksJson = typeof body.worksJson === 'string'
    ? body.worksJson
    : JSON.stringify(body.worksJson ?? [])
  const partsJson = typeof body.partsJson === 'string'
    ? body.partsJson
    : JSON.stringify(body.partsJson ?? [])
  const taxRate = body.taxRate ?? 20

  const totals = computeTotals(worksJson, partsJson, taxRate)
  if (!totals) {
    return NextResponse.json({ error: 'worksJson/partsJson invalides' }, { status: 400 })
  }
  const { totalHT, totalTTC } = totals

  // Validate optional foreign keys belong to THIS garage before referencing them.
  if (body.jobId) {
    const job = await prisma.job.findFirst({ where: { id: body.jobId, garageId: session.user.garageId } })
    if (!job) return NextResponse.json({ error: 'jobId invalide' }, { status: 400 })
  }
  if (body.mechanicId) {
    const mech = await prisma.mechanic.findFirst({ where: { id: body.mechanicId, garageId: session.user.garageId } })
    if (!mech) return NextResponse.json({ error: 'mechanicId invalide' }, { status: 400 })
  }

  const year = new Date().getFullYear()

  // Réservation du numéro + création atomiques (pas de trou de séquence) ;
  // unicité garantie par @@unique([garageId, number]).
  let workOrder
  try {
    workOrder = await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.update({
        where: { id: session.user.garageId },
        data: { workOrderCounter: { increment: 1 } },
      })
      const number = `${garage.workOrderPrefix}-${year}-${String(garage.workOrderCounter).padStart(3, '0')}`
      return tx.workOrder.create({
        data: {
          number,
          garageId: session.user.garageId,
          jobId: body.jobId ?? null,
          mechanicId: body.mechanicId ?? null,
          clientName: body.clientName,
          clientPhone: body.clientPhone ?? null,
          clientEmail: body.clientEmail ?? null,
          clientAddress: body.clientAddress ?? null,
          vehicleMake: body.vehicleMake ?? null,
          vehicleModel: body.vehicleModel ?? null,
          licensePlate: body.licensePlate ?? null,
          mileage: body.mileage ?? null,
          vin: body.vin ?? null,
          worksJson,
          partsJson,
          taxRate,
          totalHT,
          totalTTC,
          notes: body.notes ?? null,
          status: 'draft',
        },
        include: {
          mechanic: { select: { id: true, name: true, color: true } },
          job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
        },
      })
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Numéro d\'ordre de réparation déjà utilisé, réessayez' }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json(workOrder, { status: 201 })
})

export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

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

function computeTotals(worksJson: string, partsJson: string, taxRate: number) {
  const works: WorkLine[] = JSON.parse(worksJson)
  const parts: PartLine[] = JSON.parse(partsJson)
  const worksHT = works.reduce((s, w) => s + (w.unitPrice ?? 0), 0)
  const partsHT = parts.reduce((s, p) => s + (p.qty ?? 0) * (p.unitPrice ?? 0), 0)
  const totalHT = Math.round((worksHT + partsHT) * 100) / 100
  const totalTTC = Math.round(totalHT * (1 + taxRate / 100) * 100) / 100
  return { totalHT, totalTTC }
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

  // SECURITY: verify body-supplied FKs belong to this garage before persisting
  // (GET includes `job` and `mechanic`, so an unvalidated id would leak data).
  const gid = session.user.garageId
  if (body.jobId && !(await prisma.job.findFirst({ where: { id: body.jobId, garageId: gid }, select: { id: true } })))
    return NextResponse.json({ error: 'Intervention introuvable' }, { status: 400 })
  if (body.mechanicId && !(await prisma.mechanic.findFirst({ where: { id: body.mechanicId, garageId: gid }, select: { id: true } })))
    return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 400 })

  const worksJson = typeof body.worksJson === 'string'
    ? body.worksJson
    : JSON.stringify(body.worksJson ?? [])
  const partsJson = typeof body.partsJson === 'string'
    ? body.partsJson
    : JSON.stringify(body.partsJson ?? [])
  const taxRate = body.taxRate ?? 20

  const { totalHT, totalTTC } = computeTotals(worksJson, partsJson, taxRate)

  // Atomically increment workOrderCounter and generate number
  const garage = await prisma.garage.update({
    where: { id: session.user.garageId },
    data: { workOrderCounter: { increment: 1 } },
  })
  const year = new Date().getFullYear()
  const number = `${garage.workOrderPrefix}-${year}-${String(garage.workOrderCounter).padStart(3, '0')}`

  const workOrder = await prisma.workOrder.create({
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

  return NextResponse.json(workOrder, { status: 201 })
})

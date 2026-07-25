export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateJobSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/jobs?date=YYYY-MM-DD&page=1&limit=20
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const skip  = (page - 1) * limit

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (date) where.date = date

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.job.count({ where }),
  ])

  return NextResponse.json({ data: jobs, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/jobs
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    customerName,
    vehicleModel,
    licensePlate,
    repairType,
    estimatedDuration,
    startTime,
    date,
    mechanicId,
    status = 'scheduled',
    notes,
    isUrgent = false,
  } = parsed.data

  if (!customerName || !vehicleModel || !repairType || !estimatedDuration || !startTime || !date || !mechanicId) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  // Verify mechanic belongs to this garage
  const mechanic = await prisma.mechanic.findFirst({
    where: { id: mechanicId, garageId: session.user.garageId },
  })
  if (!mechanic) {
    return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  const job = await prisma.job.create({
    data: {
      customerName,
      vehicleModel,
      licensePlate: licensePlate || null,
      repairType,
      estimatedDuration: Number(estimatedDuration),
      startTime,
      date,
      status,
      notes: notes || null,
      isUrgent: Boolean(isUrgent),
      mechanicId,
      garageId: session.user.garageId,
    },
  })

  await logAudit({ action: 'create', entityType: 'Job', entityId: job.id, session, req })

  return NextResponse.json(job, { status: 201 })
})

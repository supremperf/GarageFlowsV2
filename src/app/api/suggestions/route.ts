export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { runAIEngine } from '@/lib/ai-engine'
import { Job, Mechanic } from '@/lib/types'

// GET /api/suggestions?date=YYYY-MM-DD
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

  const [dbJobs, dbMechanics] = await Promise.all([
    prisma.job.findMany({
      where: { garageId: session.user.garageId, date },
    }),
    prisma.mechanic.findMany({
      where: { garageId: session.user.garageId },
      orderBy: { order: 'asc' },
    }),
  ])

  // Map DB rows to the types the AI engine expects
  const jobs: Job[] = dbJobs.map(j => ({
    id: j.id,
    customerName: j.customerName,
    vehicleModel: j.vehicleModel,
    licensePlate: j.licensePlate ?? undefined,
    repairType: j.repairType as Job['repairType'],
    estimatedDuration: j.estimatedDuration,
    actualDuration: j.actualDuration ?? undefined,
    mechanicId: j.mechanicId,
    startTime: j.startTime,
    date: j.date,
    status: j.status as Job['status'],
    notes: j.notes ?? undefined,
    isUrgent: j.isUrgent,
    delayMinutes: j.delayMinutes ?? undefined,
    garageId: j.garageId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }))

  const mechanics: Mechanic[] = dbMechanics.map(m => ({
    id: m.id,
    name: m.name,
    avatar: m.avatar,
    color: m.color,
    isAbsent: m.isAbsent,
    specialty: JSON.parse(m.specialty) as Mechanic['specialty'],
    order: m.order,
    garageId: m.garageId,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }))

  const suggestions = runAIEngine({ jobs, mechanics, date })

  return NextResponse.json(suggestions)
})

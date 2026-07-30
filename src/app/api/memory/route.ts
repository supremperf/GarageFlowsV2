export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { subMonths, format } from 'date-fns'
import { analyzeMemory, type InterventionRecord } from '@/lib/memory'

// GET /api/memory?months=12&plate=AB-123-CD — insights from intervention history.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const months = Math.min(60, Math.max(1, Number(searchParams.get('months') ?? '12')))
  const plate = searchParams.get('plate')?.trim()
  const startDate = format(subMonths(new Date(), months - 1), 'yyyy-MM-01')

  const jobs = await prisma.job.findMany({
    where: { garageId, date: { gte: startDate }, ...(plate ? { licensePlate: plate } : {}) },
    select: {
      id: true, date: true, licensePlate: true, vehicleModel: true, repairType: true,
      estimatedDuration: true, actualDuration: true,
      mechanic: { select: { id: true, name: true } },
      jobParts: { select: { part: { select: { reference: true, name: true } } } },
    },
    orderBy: { date: 'asc' },
    take: 5000,
  })

  const records: InterventionRecord[] = jobs.map((j) => ({
    id: j.id,
    date: j.date,
    vehiclePlate: j.licensePlate,
    vehicleModel: j.vehicleModel,
    repairType: j.repairType,
    mechanicId: j.mechanic?.id ?? null,
    mechanicName: j.mechanic?.name ?? null,
    estimatedMinutes: j.estimatedDuration,
    actualMinutes: j.actualDuration,
    parts: j.jobParts.map((jp) => ({ reference: jp.part?.reference ?? null, name: jp.part?.name ?? '—' })),
  }))

  const result = analyzeMemory(records)
  return NextResponse.json({ ...result, scope: plate ? { plate } : { months } })
})

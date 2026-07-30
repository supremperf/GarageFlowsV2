export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'
import { optimizeSchedule, type SchedJob, type SchedMechanic } from '@/lib/scheduling'

function hhmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// GET /api/scheduling?date=YYYY-MM-DD&bays=2 — propose an optimized day schedule.
// This is a PROPOSAL; the user keeps final control over assignments.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')
  const bays = Math.min(20, Math.max(1, Number(searchParams.get('bays') ?? '2')))
  const dayStart = Math.max(0, Number(searchParams.get('dayStart') ?? 8 * 60))
  const dayEnd = Math.min(24 * 60, Number(searchParams.get('dayEnd') ?? 18 * 60))

  const [rawJobs, rawMechanics] = await Promise.all([
    prisma.job.findMany({
      where: { garageId, date, status: { not: 'completed' } },
      select: {
        id: true, customerName: true, vehicleModel: true, repairType: true,
        estimatedDuration: true, delayMinutes: true, isUrgent: true,
      },
    }),
    prisma.mechanic.findMany({ where: { garageId }, select: { id: true, name: true, isAbsent: true } }),
  ])

  const jobs: SchedJob[] = rawJobs.map((j) => ({
    id: j.id,
    label: `${j.customerName ?? '—'} · ${j.vehicleModel ?? ''} (${j.repairType ?? '—'})`.trim(),
    durationMin: Math.max(15, (j.estimatedDuration ?? 60) + (j.delayMinutes ?? 0)),
    urgent: !!j.isUrgent,
  }))

  const mechanics: SchedMechanic[] = rawMechanics.map((m) => ({ id: m.id, name: m.name, absent: m.isAbsent }))

  const result = optimizeSchedule(jobs, mechanics, { dayStart, dayEnd, bays })

  return NextResponse.json({
    date,
    proposal: true,
    assignments: result.assignments.map((a) => ({ ...a, startTime: hhmm(a.start), endTime: hhmm(a.end) })),
    unscheduled: result.unscheduled,
    metrics: result.metrics,
  })
})

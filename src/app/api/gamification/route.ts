export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { subMonths, format } from 'date-fns'
import { buildLeaderboard, type MechanicStats } from '@/lib/gamification'

// GET /api/gamification?months=3 — scores, levels, badges and leaderboard.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const months = Math.min(24, Math.max(1, Number(searchParams.get('months') ?? '3')))
  const startDate = format(subMonths(new Date(), months - 1), 'yyyy-MM-01')

  const [mechanics, jobs] = await Promise.all([
    prisma.mechanic.findMany({ where: { garageId }, select: { id: true, name: true } }),
    prisma.job.findMany({
      where: { garageId, status: 'completed', date: { gte: startDate } },
      select: { mechanicId: true, estimatedDuration: true, actualDuration: true, delayMinutes: true },
    }),
  ])

  const stats = new Map<string, MechanicStats>()
  for (const m of mechanics) {
    stats.set(m.id, {
      id: m.id, name: m.name, jobsCompleted: 0, estimatedMinutes: 0, actualMinutes: 0,
      onTimeJobs: 0, reworkJobs: 0, satisfactionSum: 0, satisfactionCount: 0,
    })
  }

  for (const j of jobs) {
    if (!j.mechanicId) continue
    const s = stats.get(j.mechanicId)
    if (!s) continue
    s.jobsCompleted += 1
    s.estimatedMinutes += j.estimatedDuration ?? 0
    s.actualMinutes += j.actualDuration ?? 0
    if ((j.delayMinutes ?? 0) === 0) s.onTimeJobs += 1
  }

  const leaderboard = buildLeaderboard(Array.from(stats.values()))
  return NextResponse.json(leaderboard)
})

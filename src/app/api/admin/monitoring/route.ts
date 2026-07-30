export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/monitoring — infrastructure supervision (Phase 1).
 *
 * Returns live host + process + database metrics graded against thresholds.
 * Manager/owner only. All values are measured, never simulated.
 */

import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { APP_CONFIG } from '@/config/app'
import { collectSystemMetrics, collectProcessMetrics, gradeMetrics } from '@/lib/monitoring/metrics'

export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!(APP_CONFIG.managerRoles as readonly string[]).includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès réservé (propriétaire / responsable)' }, { status: 403 })
  }

  // Database reachability + latency.
  let dbLatencyMs: number | null = null
  let dbError: string | null = null
  const started = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    dbLatencyMs = Date.now() - started
  } catch {
    dbError = 'unreachable'
  }

  const system = collectSystemMetrics()
  const proc = collectProcessMetrics()
  const { statuses, overall } = gradeMetrics(system, dbLatencyMs)

  return NextResponse.json({
    overall,
    statuses,
    system,
    process: proc,
    database: { latencyMs: dbLatencyMs, error: dbError },
    ts: new Date().toISOString(),
  })
})

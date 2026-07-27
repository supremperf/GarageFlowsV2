export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/health?period=30  (Phase 5 — Indicateur Santé du Garage)
 *
 * Returns the garage health score (0–100) with per-component sub-scores, a
 * period-over-period trend and data-referenced recommendations. Computed
 * entirely from the authenticated garage's real data; components lacking data
 * are excluded and flagged (never fabricated).
 */

import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { collectGarageWindows, normalizePeriod } from '@/lib/analytics/collect'
import { computeMetrics } from '@/lib/analytics/metrics'
import { computeHealthScore } from '@/lib/analytics/health-score'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const period = normalizePeriod(searchParams.get('period') ?? '30')

  const { current, previous } = await collectGarageWindows(session.user.garageId, period)
  const metrics = computeMetrics(current)
  const health = computeHealthScore(metrics, computeMetrics(previous))

  return NextResponse.json({ period, health, metrics })
})

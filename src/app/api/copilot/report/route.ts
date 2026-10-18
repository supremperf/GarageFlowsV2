export const dynamic = 'force-dynamic'

/**
 * GET /api/copilot/report?period=30  (Phases 4 & 6 — Copilote « Analyser mon garage »)
 *
 * Generates the full garage analysis report: health score, prioritised findings
 * ranked by impact, a labelled weekly-margin forecast and explicit data gaps.
 * Every finding is deterministic and carries the real figures that produced it —
 * there is no language model in the loop, so no hallucination. Scoped to the
 * authenticated garage.
 */

import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { collectGarageWindows, normalizePeriod } from '@/lib/analytics/collect'
import { computeMetrics } from '@/lib/analytics/metrics'
import { buildCopilotReport } from '@/lib/analytics/insights'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  // Le rapport expose CA / marge / prévisions financières → réservé à financial:read
  // (OWNER/MANAGER), comme l'export FEC. Sans ce contrôle, RECEPTIONIST/MECHANIC
  // liraient les chiffres financiers du garage.
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const period = normalizePeriod(searchParams.get('period') ?? '30')

  const { current, previous } = await collectGarageWindows(session.user.garageId, period)
  const metrics = computeMetrics(current)
  const report = buildCopilotReport(metrics, computeMetrics(previous))

  return NextResponse.json({ period, report, metrics })
})

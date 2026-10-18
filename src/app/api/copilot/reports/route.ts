export const dynamic = 'force-dynamic'

/**
 * Copilote report history (Phase 4/6).
 *   GET  — list saved reports (metadata only).
 *   POST — generate the current report and historise it. Body: { period? }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { collectGarageWindows, normalizePeriod } from '@/lib/analytics/collect'
import { computeMetrics } from '@/lib/analytics/metrics'
import { buildCopilotReport } from '@/lib/analytics/insights'

export const GET = withAuth(async () => {
  const session = await requireSession()
  // Historique de rapports financiers (score, CA, marge) → financial:read requis.
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const reports = await prisma.reportSnapshot.findMany({
    where: { garageId: session.user.garageId },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, periodDays: true, healthScore: true, summary: true, createdBy: true, createdAt: true },
  })
  return NextResponse.json({ reports })
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const period = normalizePeriod(body.period ?? 30)

  const { current, previous } = await collectGarageWindows(session.user.garageId, period)
  const report = buildCopilotReport(computeMetrics(current), computeMetrics(previous))

  const saved = await prisma.reportSnapshot.create({
    data: {
      garageId: session.user.garageId,
      periodDays: report.periodDays,
      healthScore: report.healthScore,
      summary: report.summary,
      payload: JSON.stringify(report),
      createdBy: session.user.name ?? session.user.email ?? null,
    },
    select: { id: true, createdAt: true },
  })
  return NextResponse.json({ ok: true, id: saved.id, createdAt: saved.createdAt, report }, { status: 201 })
})

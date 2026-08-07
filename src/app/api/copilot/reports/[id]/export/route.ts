export const dynamic = 'force-dynamic'

/**
 * GET /api/copilot/reports/[id]/export?format=csv|json — download a historised
 * report (garage-scoped). CSV opens in Excel; JSON is the full report object.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { reportToCSV } from '@/lib/analytics/report-export'
import type { CopilotReport } from '@/lib/analytics/insights'

export const GET = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Export d'un rapport financier historisé → financial:read requis.
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const format = new URL(req.url).searchParams.get('format') === 'json' ? 'json' : 'csv'

  const snapshot = await prisma.reportSnapshot.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!snapshot) return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 })

  const report = JSON.parse(snapshot.payload) as CopilotReport
  const base = `garageflow-rapport-${snapshot.createdAt.toISOString().slice(0, 10)}-${snapshot.id}`

  if (format === 'json') {
    return new NextResponse(snapshot.payload, {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${base}.json"` },
    })
  }
  return new NextResponse(reportToCSV(report), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` },
  })
})

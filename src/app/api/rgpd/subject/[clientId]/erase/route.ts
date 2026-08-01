export const dynamic = 'force-dynamic'

/**
 * POST /api/rgpd/subject/[clientId]/erase  (propriétaire)
 * Droit à l'effacement : anonymise les données personnelles du client (les
 * documents comptables sont conservés mais neutralisés) et supprime le compte
 * portail. Requiert { confirm: <clientId> } comme acquittement explicite.
 */
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { eraseSubject } from '@/lib/rgpd/subject'

export const POST = withAuth(async (req, ctx?: { params: { clientId: string } }) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const clientId = ctx?.params.clientId ?? ''
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.confirm !== clientId) {
    return NextResponse.json({ error: 'Confirmation invalide (confirm doit égaler l’id du client).' }, { status: 400 })
  }

  const report = await eraseSubject(session.user.garageId, clientId)
  if (!report.ok) return NextResponse.json(report, { status: 404 })

  await logAudit({ action: 'update', entityType: 'Client', entityId: clientId, session, req, details: { rgpdErase: true, anonymized: report.anonymized, deleted: report.deleted } })
  return NextResponse.json(report)
})

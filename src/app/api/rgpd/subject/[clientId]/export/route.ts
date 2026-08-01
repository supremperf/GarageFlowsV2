export const dynamic = 'force-dynamic'

/**
 * GET /api/rgpd/subject/[clientId]/export  (propriétaire)
 * Droit d'accès / portabilité : export des données personnelles d'un client,
 * scopé au garage courant. Ne renvoie jamais de hash de mot de passe / secret.
 */
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { exportSubject } from '@/lib/rgpd/subject'

export const GET = withAuth(async (req, ctx?: { params: { clientId: string } }) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const clientId = ctx?.params.clientId ?? ''
  const data = await exportSubject(session.user.garageId, clientId)
  if (!data) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  await logAudit({ action: 'update', entityType: 'Client', entityId: clientId, session, req, details: { rgpdExport: true } })
  return NextResponse.json(data)
})

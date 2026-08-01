export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backups/restore-blob — restauration PORTABLE (propriétaire).
 * Restaure un blob de sauvegarde chiffré fourni directement (issu d'une autre
 * machine / stockage hors-site), SANS BackupRecord local. OVERWRITE des données
 * du garage. La sauvegarde doit concerner le garage courant (garde-fou).
 * Body: { blob, passphrase?, confirm }  (confirm doit égaler l'id du garage)
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { restoreFromBlob } from '@/lib/backup/service'
import { logAudit } from '@/lib/audit'

function requireOwner(session: Session): void {
  if (session.user.role !== 'OWNER') throw NextResponse.json({ error: 'Réservé au propriétaire du garage' }, { status: 403 })
}

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  requireOwner(session)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const blob = typeof body.blob === 'string' ? body.blob : ''
  const passphrase = typeof body.passphrase === 'string' && body.passphrase ? body.passphrase : undefined
  const confirm = typeof body.confirm === 'string' ? body.confirm : ''

  if (!blob) return NextResponse.json({ error: 'Sauvegarde (blob) manquante' }, { status: 400 })
  // Acquittement explicite : l'opérateur confirme l'id du garage cible.
  if (confirm !== session.user.garageId) {
    return NextResponse.json({ error: 'Confirmation invalide (confirm doit égaler l’id du garage courant).' }, { status: 400 })
  }

  const report = await restoreFromBlob(blob, { passphrase, confirmGarageId: session.user.garageId })
  if (report.ok) {
    await logAudit({ action: 'update', entityType: 'Garage', entityId: session.user.garageId, session, req, details: { restoredFromBlob: true, counts: report.restored } })
  }
  return NextResponse.json(report, { status: report.ok ? 200 : 400 })
})

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backups/[id]/restore — restore a backup (owner only).
 * OVERWRITES the garage's current data. Requires { confirm: <backupId> } as an
 * explicit acknowledgement. Body: { confirm, passphrase? }
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { restoreBackup } from '@/lib/backup/service'
import { logAudit } from '@/lib/audit'

function requireOwner(session: Session): void {
  if (session.user.role !== 'OWNER') throw NextResponse.json({ error: 'Réservé au propriétaire du garage' }, { status: 403 })
}

export const POST = withAuth(async (req, ctx?: { params: { id: string } }) => {
  const session = await requireSession()
  requireOwner(session)
  const id = ctx?.params.id ?? ''

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const confirm = typeof body.confirm === 'string' ? body.confirm : ''
  const passphrase = typeof body.passphrase === 'string' && body.passphrase ? body.passphrase : undefined

  const result = await restoreBackup(session.user.garageId, id, { confirm, passphrase })
  if (result.ok) {
    await logAudit({ action: 'update', entityType: 'Garage', entityId: session.user.garageId, session, req, details: { restoredBackup: id } })
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
})

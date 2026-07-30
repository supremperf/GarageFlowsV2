export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/backups/[id]/download — download the encrypted backup blob
 * (owner only), for off-site storage. The blob is AES-256-GCM encrypted; without
 * the key/passphrase it is opaque.
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { readBackupBlob } from '@/lib/backup/service'

function requireOwner(session: Session): void {
  if (session.user.role !== 'OWNER') throw NextResponse.json({ error: 'Réservé au propriétaire du garage' }, { status: 403 })
}

export const GET = withAuth(async (_req, ctx?: { params: { id: string } }) => {
  const session = await requireSession()
  requireOwner(session)
  const id = ctx?.params.id ?? ''

  const result = await readBackupBlob(session.user.garageId, id)
  if (!result) return NextResponse.json({ error: 'Sauvegarde introuvable' }, { status: 404 })

  return new NextResponse(result.blob, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  })
})

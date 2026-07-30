export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backups/[id]/verify — automatic restore test (owner only).
 * Decrypts and integrity-checks the backup WITHOUT touching live data.
 * Body: { passphrase? } (required for passphrase-encrypted backups).
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { verifyBackup } from '@/lib/backup/service'

function requireOwner(session: Session): void {
  if (session.user.role !== 'OWNER') throw NextResponse.json({ error: 'Réservé au propriétaire du garage' }, { status: 403 })
}

export const POST = withAuth(async (req, ctx?: { params: { id: string } }) => {
  const session = await requireSession()
  requireOwner(session)
  const id = ctx?.params.id ?? ''

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const passphrase = typeof body.passphrase === 'string' && body.passphrase ? body.passphrase : undefined

  const result = await verifyBackup(session.user.garageId, id, passphrase)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
})

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/2fa/enable — confirm and activate 2FA (authenticated).
 * Body: { token }  (a TOTP code from the pending secret)
 * On success, activates 2FA and returns one-time backup codes (shown once).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { verifyTotp } from '@/lib/portal/totp'
import { generateBackupCodes } from '@/lib/portal/backup-codes'

export const POST = withPortalAuth(async (req, { user }) => {
  if (user.twoFactorEnabled) return NextResponse.json({ error: 'Déjà activée' }, { status: 409 })
  if (!user.twoFactorPending) return NextResponse.json({ error: 'Aucune configuration en cours (appelez /2fa/setup)' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }
  const token = typeof body.token === 'string' ? body.token : ''

  if (!verifyTotp(token, user.twoFactorPending)) {
    return NextResponse.json({ error: 'Code invalide' }, { status: 401 })
  }

  const { codes, hashes } = generateBackupCodes(10)
  await prisma.portalUser.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: user.twoFactorPending,
      twoFactorPending: null,
      backupCodes: JSON.stringify(hashes),
    },
  })

  // Backup codes are returned exactly once and stored only as hashes.
  return NextResponse.json({ ok: true, backupCodes: codes })
})

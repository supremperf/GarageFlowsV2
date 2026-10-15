export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/auth/me — current portal account profile & security status.
 */

import { NextResponse } from 'next/server'
import { withPortalAuth } from '@/lib/portal/auth-helpers'

export const GET = withPortalAuth(async (_req, { user, device }) => {
  let backupCodesRemaining = 0
  try {
    const parsed = JSON.parse(user.backupCodes)
    if (Array.isArray(parsed)) backupCodesRemaining = parsed.length
  } catch {
    backupCodesRemaining = 0
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      clientId: user.clientId,
      // Changement d'adresse EN ATTENTE de confirmation (GF-DUR-028). Sans
      // cette information, un client qui a demandé un changement puis rechargé
      // sa page ne voit plus aucune trace de sa demande : il conclut qu'elle
      // n'a pas abouti, recommence, et ne comprend pas pourquoi son ancienne
      // adresse reste la seule qui le connecte. C'est SA demande et SA future
      // adresse : la lui rendre ne divulgue rien.
      pendingEmail: user.pendingEmail,
    },
    session: { deviceId: device.id, since: device.createdAt },
    backupCodesRemaining,
  })
})

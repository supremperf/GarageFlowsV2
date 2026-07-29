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
    },
    session: { deviceId: device.id, since: device.createdAt },
    backupCodesRemaining,
  })
})

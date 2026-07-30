export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/logout — revoke the current session (or all).
 * Body: { all?: boolean }  — when true, performs a global logout (all devices).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth, clearPortalCookie } from '@/lib/portal/auth-helpers'

export const POST = withPortalAuth(async (req, { user, device }) => {
  let all = false
  try {
    const body = (await req.json()) as Record<string, unknown>
    all = body.all === true
  } catch {
    all = false
  }

  if (all) {
    await prisma.portalDevice.updateMany({
      where: { portalUserId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  } else {
    await prisma.portalDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } })
  }

  const res = NextResponse.json({ ok: true, scope: all ? 'all' : 'current' })
  clearPortalCookie(res)
  return res
})

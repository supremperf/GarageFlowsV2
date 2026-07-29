export const dynamic = 'force-dynamic'

/**
 * Connected devices (Phase 2 — « Appareils autorisés »).
 *   GET  — list the account's sessions (current one flagged).
 *   POST — revoke a session by id ({ deviceId }); revoking the current one logs out.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth, clearPortalCookie } from '@/lib/portal/auth-helpers'

export const GET = withPortalAuth(async (_req, { user, device }) => {
  const devices = await prisma.portalDevice.findMany({
    where: { portalUserId: user.id },
    orderBy: { lastSeenAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({
    devices: devices.map(d => ({
      id: d.id,
      userAgent: d.userAgent,
      ipAddress: d.ipAddress,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      revoked: !!d.revokedAt,
      current: d.id === device.id,
    })),
  })
})

export const POST = withPortalAuth(async (req, { user, device }) => {
  let deviceId = ''
  try {
    const body = (await req.json()) as Record<string, unknown>
    deviceId = String(body.deviceId ?? '')
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }
  if (!deviceId) return NextResponse.json({ error: 'deviceId requis' }, { status: 400 })

  const target = await prisma.portalDevice.findFirst({ where: { id: deviceId, portalUserId: user.id } })
  if (!target) return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 })

  await prisma.portalDevice.update({ where: { id: target.id }, data: { revokedAt: new Date() } })

  const revokedCurrent = target.id === device.id
  const res = NextResponse.json({ ok: true, revokedCurrent })
  if (revokedCurrent) clearPortalCookie(res)
  return res
})

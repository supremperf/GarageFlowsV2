export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can, type Permission } from '@/lib/authz'
import { macFor, disconnectDevices } from '@/lib/license/mechanic-admin'
import { logAudit } from '@/lib/audit'

// POST /api/mechanic-licenses/[lid]/status  { status: 'suspended'|'active'|'revoked' }
// Suspend / réactive / révoque UNE clé mécanicien (OWNER). Ne touche jamais les
// autres clés ni la licence Garage. suspend/revoke coupent aussi les appareils.
const PERM_BY_STATUS: Record<string, Permission> = {
  suspended: 'mechanicLicense:suspend',
  active: 'mechanicLicense:reactivate',
  revoked: 'mechanicLicense:revoke',
}
const ACTION_BY_STATUS: Record<string, string> = {
  suspended: 'suspend',
  active: 'reactivate',
  revoked: 'revoke',
}

export const POST = withAuth(async (req, { params }: { params: { lid: string } }) => {
  const session = await requireSession()

  let body: { status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const status = typeof body.status === 'string' ? body.status : ''
  const perm = PERM_BY_STATUS[status]
  if (!perm) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
  if (!can(session.user.role, perm)) {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const garageId = session.user.garageId

  const license = await prisma.licenseKey.findFirst({
    where: { licenseId: params.lid, garageId, licenseType: 'mechanic' },
  })
  if (!license) return NextResponse.json({ error: 'Clé introuvable.' }, { status: 404 })

  const now = new Date()
  const newMac = macFor({
    licenseId: license.licenseId, token: license.token, status,
    expiryAt: license.expiryAt, hwid: license.hwid,
    parentLicenseId: license.parentLicenseId, mechanicId: license.mechanicId,
  })

  await prisma.licenseKey.update({
    where: { id: license.id },
    data: {
      status,
      recordMac: newMac,
      revokedAt: status === 'revoked' ? now : status === 'active' ? null : license.revokedAt,
      suspendedAt: status === 'suspended' ? now : status === 'active' ? null : license.suspendedAt,
    },
  })

  // suspend/revoke : couper immédiatement les appareils/sessions.
  if (status === 'suspended' || status === 'revoked') {
    await disconnectDevices(license.licenseId, status)
  }

  await prisma.mechanicActionAudit.create({
    data: {
      garageId,
      // Action STAFF (propriétaire) : acteur et cible séparés ; targetMechanicId
      // NULL si la clé n'est pas encore attribuée — jamais la chaîne vide.
      actorUserId: session.user.id, actorRole: session.user.role,
      targetMechanicId: license.mechanicId ?? null, licenseId: license.licenseId,
      action: ACTION_BY_STATUS[status], targetType: 'LicenseKey', targetId: license.licenseId,
    },
  }).catch(() => {})

  await logAudit({ action: 'update', entityType: 'License', entityId: license.licenseId, session, req, details: { status } })

  return NextResponse.json({ ok: true, licenseId: license.licenseId, status })
})

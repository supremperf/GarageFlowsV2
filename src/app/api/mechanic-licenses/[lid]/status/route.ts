export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can, type Permission } from '@/lib/authz'
import { macFor, revokeDevices } from '@/lib/license/mechanic-admin'
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

  // §2 — RÉVOCATION IRRÉVERSIBLE. Transitions autorisées :
  //   active⇄suspended, active→revoked, suspended→revoked.
  // INTERDITES : revoked→active, revoked→suspended. Une clé révoquée le reste ;
  // le remplacement se fait en générant une NOUVELLE clé (jamais en ressuscitant
  // l'ancienne). On teste status ET revokedAt (défense en profondeur).
  const isRevoked = license.status === 'revoked' || !!license.revokedAt
  if (isRevoked && status !== 'revoked') {
    return NextResponse.json(
      { error: 'Cette clé a été révoquée définitivement. Générez une nouvelle clé de remplacement.' },
      { status: 409 },
    )
  }

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

  // §1/§3 — Effet sur les appareils selon la transition :
  //  - REVOKED : révocation PERMANENTE des appareils (ne pourront plus se réactiver).
  //  - SUSPENDED : on NE touche PAS les appareils. La licence 'suspended' bloque déjà
  //    toute session (validateDeviceToken/validateMechanicSession) ; les appareils
  //    restent 'active' → le SIÈGE est CONSERVÉ (les licences suspendues comptent dans
  //    le quota) et la réactivation est INSTANTANÉE au retour en 'active' (unsuspend),
  //    sans re-consommer de siège ni forcer une réactivation manuelle.
  //  - ACTIVE (réactivation) : rien à faire côté appareils (le statut licence rétablit l'accès).
  if (status === 'revoked') {
    await revokeDevices(license.licenseId, 'license_revoked')
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

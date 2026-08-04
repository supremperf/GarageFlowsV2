export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { disconnectDevices } from '@/lib/license/mechanic-admin'
import { logAudit } from '@/lib/audit'

// POST /api/mechanic-licenses/[lid]/disconnect
// Déconnecte tous les appareils d'une clé mécanicien (OWNER/MANAGER) sans la
// révoquer : le mécanicien devra réactiver sa clé pour se reconnecter.
export const POST = withAuth(async (req, { params }: { params: { lid: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:disconnect')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const garageId = session.user.garageId

  const license = await prisma.licenseKey.findFirst({
    where: { licenseId: params.lid, garageId, licenseType: 'mechanic' },
    select: { licenseId: true, mechanicId: true },
  })
  if (!license) return NextResponse.json({ error: 'Clé introuvable.' }, { status: 404 })

  // §2 — DÉCONNEXION : coupe la session et libère le siège (appareils passés à
  // 'deactivated'), SANS révoquer : le mécanicien pourra se reconnecter avec sa
  // clé encore valide. La licence elle-même reste 'active'.
  const count = await disconnectDevices(license.licenseId)

  await prisma.mechanicActionAudit.create({
    data: { garageId, actorUserId: session.user.id, actorRole: session.user.role, targetMechanicId: license.mechanicId ?? null, licenseId: license.licenseId, action: 'disconnect', targetType: 'LicenseKey', targetId: license.licenseId, metadata: JSON.stringify({ devices: count }) },
  }).catch(() => {})
  await logAudit({ action: 'update', entityType: 'License', entityId: license.licenseId, session, req, details: { disconnect: count } })

  return NextResponse.json({ ok: true, disconnected: count })
})

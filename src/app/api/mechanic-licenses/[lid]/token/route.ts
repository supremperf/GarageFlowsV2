export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { logAudit } from '@/lib/audit'

// GET /api/mechanic-licenses/[lid]/token
// Renvoie le token complet d'UNE clé mécanicien du garage (OWNER seul), pour
// copie contrôlée. Accès tracé (audit) — jamais exposé dans la liste générale.
export const GET = withAuth(async (req, { params }: { params: { lid: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:copyToken')) {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const garageId = session.user.garageId

  const license = await prisma.licenseKey.findFirst({
    where: { licenseId: params.lid, garageId, licenseType: 'mechanic' },
    select: { licenseId: true, token: true, mechanicId: true },
  })
  if (!license) return NextResponse.json({ error: 'Clé introuvable.' }, { status: 404 })

  await prisma.mechanicActionAudit.create({
    data: { garageId, actorUserId: session.user.id, actorRole: session.user.role, targetMechanicId: license.mechanicId ?? null, licenseId: license.licenseId, action: 'token_copied', targetType: 'LicenseKey', targetId: license.licenseId },
  }).catch(() => {})
  await logAudit({ action: 'update', entityType: 'License', entityId: license.licenseId, session, req, details: { tokenCopied: true } })

  return NextResponse.json({ licenseId: license.licenseId, token: license.token })
})

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { macFor } from '@/lib/license/mechanic-admin'
import { logAudit } from '@/lib/audit'
import { pushMechanicAssignment } from '@/lib/sync/mechanic-sync'

// POST /api/mechanic-licenses/[lid]/assign  { mechanicId }
// Attribue (ou réattribue) une clé mécanicien à un mécanicien du garage (OWNER).
// Une RÉATTRIBUTION : trace l'historique, désactive les appareils de l'ancien
// titulaire (sessions invalidées) et recalcule l'intégrité (recordMac).
export const POST = withAuth(async (req, { params }: { params: { lid: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:assign')) {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const garageId = session.user.garageId

  let body: { mechanicId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const mechanicId = typeof body.mechanicId === 'string' ? body.mechanicId : ''
  if (!mechanicId) return NextResponse.json({ error: 'Mécanicien manquant' }, { status: 400 })

  // La clé DOIT appartenir à ce garage et être de type mechanic.
  const license = await prisma.licenseKey.findFirst({
    where: { licenseId: params.lid, garageId, licenseType: 'mechanic' },
  })
  if (!license) return NextResponse.json({ error: 'Clé introuvable.' }, { status: 404 })

  // Le mécanicien cible DOIT appartenir au même garage.
  const mechanic = await prisma.mechanic.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } })
  if (!mechanic) return NextResponse.json({ error: 'Mécanicien introuvable.' }, { status: 404 })

  const previousMechanicId = license.mechanicId
  if (previousMechanicId === mechanicId) {
    return NextResponse.json({ error: 'Cette clé est déjà attribuée à ce mécanicien.' }, { status: 409 })
  }
  const isReassignment = !!previousMechanicId

  const now = new Date()
  const newMac = macFor({
    licenseId: license.licenseId, token: license.token, status: license.status,
    expiryAt: license.expiryAt, hwid: license.hwid,
    parentLicenseId: license.parentLicenseId, mechanicId,
  })

  await prisma.$transaction(async (tx) => {
    // Clôturer l'attribution précédente dans l'historique.
    if (isReassignment) {
      await tx.mechanicLicenseAssignment.updateMany({
        where: { licenseId: license.licenseId, unassignedAt: null },
        data: { unassignedAt: now },
      })
    }
    await tx.licenseKey.update({
      where: { id: license.id },
      // `cloudSyncedAt: null` — la clé change de titulaire, le cloud ne connaît
      // donc plus son état. Sans cette remise à zéro, une RÉATTRIBUTION gardait
      // l'horodatage de l'attribution précédente : l'écran affichait
      // « Synchronisée » alors que le cloud associait encore la clé à l'ancien
      // mécanicien, et le rattrapage — qui filtre sur `cloudSyncedAt: null` —
      // ne la voyait jamais. (`cloudSyncedAt` n'entre pas dans `recordMac`.)
      data: { mechanicId, assignedAt: now, assignedBy: session.user.id, recordMac: newMac, cloudSyncedAt: null },
    })
    await tx.mechanicLicenseAssignment.create({
      data: {
        licenseId: license.licenseId,
        mechanicId,
        garageId,
        assignedBy: session.user.id,
        previousMechanicId: previousMechanicId ?? null,
      },
    })
    // Réattribution : couper les sessions/appareils de l'ancien titulaire. On
    // révoque TOUS les appareils non révoqués (actifs ET déconnectés), comme
    // revokeDevices() (mechanic-admin.ts) — l'ancien code n'en coupait que les
    // « active », laissant un appareil « deactivated » de l'ancien titulaire
    // retenir un siège. La révocation est PERMANENTE (un appareil révoqué ne peut
    // pas se réactiver seul).
    //
    // RÉSIDUEL CONNU (docs/audit + EXTERNAL_BLOCKERS) : la clé mécanicien est un
    // jeton PORTEUR ; un ancien titulaire qui a CONSERVÉ la chaîne du token peut
    // encore tenter une RÉ-ACTIVATION FRAÎCHE (nouvel appareil) et obtenir
    // l'identité du NOUVEAU titulaire tant que le siège (seats=1) est libre. Le
    // plafond de sièges le bloque dès que le nouveau titulaire s'est activé, mais
    // fermer complètement la fenêtre exige une ROTATION/RÉ-ÉMISSION de clé à la
    // réattribution (décision produit) — suivi comme finding P2 OUVERT.
    if (isReassignment) {
      await tx.licenseDevice.updateMany({
        where: { licenseId: license.licenseId, status: { in: ['active', 'deactivated'] } },
        data: { status: 'revoked', revokedAt: now, revokeReason: 'reassigned' },
      })
    }
    await tx.mechanicActionAudit.create({
      data: {
        garageId,
        // Action STAFF : l'acteur est le propriétaire, la cible est le NOUVEAU titulaire.
        actorUserId: session.user.id, actorRole: session.user.role,
        targetMechanicId: mechanicId, licenseId: license.licenseId,
        action: isReassignment ? 'reassign' : 'assign',
        targetType: 'LicenseKey', targetId: license.licenseId,
        metadata: previousMechanicId ? JSON.stringify({ previousMechanicId }) : null,
      },
    })
  })

  await logAudit({ action: 'update', entityType: 'License', entityId: license.licenseId, session, req, details: { assign: mechanicId, reassignment: isReassignment } })

  // ── Remontée vers le CLOUD (poste uniquement) ───────────────────────────────
  // L'attribution vit dans la base du poste ; sans cette remontée, la PWA ne la
  // connaît pas et refuse l'activation du mécanicien (MECHANIC_KEY_UNASSIGNED).
  // Best-effort APRÈS le commit local : le patron n'est jamais bloqué par le
  // réseau, et l'interface affiche l'état RÉEL (jamais un faux « succès »).
  const sync = await pushMechanicAssignment(license.licenseId)

  return NextResponse.json({
    ok: true,
    licenseId: license.licenseId,
    mechanicId,
    reassignment: isReassignment,
    cloudSynced: sync.synced,
    cloudSyncCode: sync.synced ? undefined : sync.code,
  })
})

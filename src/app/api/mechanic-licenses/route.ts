export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { verifyLicenseToken } from '@/lib/license/verify'
import {
  macFor,
  getMaxMechanicKeys,
  MechanicConfigError,
  MechanicKeyCapError,
} from '@/lib/license/mechanic-admin'
import { logAudit } from '@/lib/audit'

/** Réponse 500 claire pour une configuration serveur invalide (jamais un cap silencieux). */
function configErrorResponse(e: MechanicConfigError): NextResponse {
  return NextResponse.json({ error: e.message, code: 'CONFIG_ERROR' }, { status: 500 })
}

// GET /api/mechanic-licenses — liste des clés mécanicien du garage (OWNER/MANAGER).
// Le token complet n'est JAMAIS renvoyé ici (voir /[lid]/token, OWNER seul).
export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const garageId = session.user.garageId

  // Réconciliation (self-heal) : rattache à CE garage les clés mécanicien dont la
  // licence garage parente (plid SIGNÉ, donc de confiance) appartient au garage
  // mais dont le garageId n'a pas encore été posé — cas d'une clé enregistrée par
  // le keygen AVANT que le patron n'ait activé sa licence garage (le garageId du
  // parent n'était alors pas encore lié). Elles apparaissent ainsi « directement »
  // ici sans dépendre de l'ordre d'enregistrement. garageId n'entre PAS dans le
  // recordMac → aucun MAC à recalculer ; aucune fuite inter-garage (on ne relie
  // que des clés dont le parent appartient déjà à ce garage).
  try {
    const parentIds = (
      await prisma.licenseKey.findMany({
        where: { garageId, licenseType: { not: 'mechanic' } },
        select: { licenseId: true },
      })
    ).map((p) => p.licenseId)
    if (parentIds.length > 0) {
      await prisma.licenseKey.updateMany({
        where: { licenseType: 'mechanic', garageId: null, parentLicenseId: { in: parentIds } },
        data: { garageId },
      })
    }
  } catch {
    // Best-effort : un échec de réconciliation ne doit jamais casser la lecture.
  }

  const [licenses, mechanics] = await Promise.all([
    prisma.licenseKey.findMany({
      where: { garageId, licenseType: 'mechanic' },
      select: {
        licenseId: true, status: true, expiryAt: true, mechanicId: true,
        mechanicHint: true, assignedAt: true, lastSeenAt: true, createdAt: true, suspendedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.mechanic.findMany({ where: { garageId }, select: { id: true, name: true } }),
  ])

  const mechName = new Map(mechanics.map((m) => [m.id, m.name]))

  // Compter les appareils actifs par clé (indicateur « connecté »).
  const deviceCounts = await prisma.licenseDevice.groupBy({
    by: ['licenseId'],
    where: { licenseId: { in: licenses.map((l) => l.licenseId) }, status: 'active' },
    _count: { _all: true },
  }).catch(() => [] as { licenseId: string; _count: { _all: number } }[])
  const activeDevices = new Map(deviceCounts.map((d) => [d.licenseId, d._count._all]))

  const data = licenses.map((l) => ({
    licenseId: l.licenseId,
    status: l.status,
    expiryAt: l.expiryAt,
    mechanicId: l.mechanicId,
    mechanicName: l.mechanicId ? (mechName.get(l.mechanicId) ?? null) : null,
    mechanicHint: l.mechanicHint,
    assigned: !!l.mechanicId,
    assignedAt: l.assignedAt,
    lastSeenAt: l.lastSeenAt,
    suspendedAt: l.suspendedAt,
    createdAt: l.createdAt,
    activeDevices: activeDevices.get(l.licenseId) ?? 0,
  }))

  let max: number
  try {
    max = getMaxMechanicKeys()
  } catch (e) {
    if (e instanceof MechanicConfigError) return configErrorResponse(e)
    throw e
  }
  return NextResponse.json({ data, max, total: data.length })
})

// POST /api/mechanic-licenses  { token }
// Enregistre une clé mécanicien signée pour ce garage (OWNER). La clé doit
// référencer (plid) une licence Garage de CE garage. Plafond configurable.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:register')) {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }
  const garageId = session.user.garageId

  let body: { token?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return NextResponse.json({ error: 'Clé manquante' }, { status: 400 })

  const verified = verifyLicenseToken(token)
  if (!verified.valid || !verified.payload) {
    return NextResponse.json({ error: verified.reason ?? 'Clé invalide' }, { status: 400 })
  }
  if (!verified.isMechanic || !verified.payload.plid) {
    return NextResponse.json({ error: 'Cette clé n\'est pas une clé mécanicien.' }, { status: 400 })
  }
  const payload = verified.payload

  // La licence Garage parente doit appartenir à CE garage.
  const parent = await prisma.licenseKey.findUnique({ where: { licenseId: payload.plid } })

  // Rattachement à la PREMIÈRE UTILISATION, strictement identique à celui de
  // validateLicensedSession (atomique, puis immuable). Indispensable sur
  // Electron : l'application des licences y est désactivée par conception
  // (licenseEnforcementEnabled() est faux — cf. src/lib/api-helpers.ts), donc
  // validateLicensedSession — le seul endroit qui posait garageId — ne s'exécute
  // jamais sur le poste. La ligne LicenseKey locale restait sans garageId et ce
  // contrôle échouait TOUJOURS avec « Licence garage parente introuvable pour ce
  // garage », rendant l'onglet « Accès mécaniciens » inutilisable sur desktop.
  // On ne rattache QUE si la licence est encore libre, et le plid provient d'un
  // jeton SIGNÉ : un autre garage ne peut donc pas s'approprier une licence.
  let parentGarageId = parent?.garageId ?? null
  if (parent && !parentGarageId && parent.licenseType !== 'mechanic') {
    const bind = await prisma.licenseKey.updateMany({
      where: { licenseId: payload.plid, garageId: null },
      data:  { garageId },
    })
    parentGarageId = bind.count > 0
      ? garageId
      : (await prisma.licenseKey.findUnique({ where: { licenseId: payload.plid } }))?.garageId ?? null
  }

  if (!parent || parentGarageId !== garageId || parent.licenseType === 'mechanic') {
    // Message neutre : ne pas confirmer l'existence d'une licence d'un autre garage.
    return NextResponse.json({ error: 'Licence garage parente introuvable pour ce garage.' }, { status: 400 })
  }

  // Doublon ?
  const existing = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })
  if (existing) {
    return NextResponse.json({ error: 'Cette clé est déjà enregistrée.' }, { status: 409 })
  }

  // Plafond validé STRICTEMENT (config invalide ⇒ 500 clair, jamais de cap NaN
  // qui désactivait silencieusement la limite).
  let max: number
  try {
    max = getMaxMechanicKeys()
  } catch (e) {
    if (e instanceof MechanicConfigError) return configErrorResponse(e)
    throw e
  }

  const expiryAt = new Date(payload.exp * 1000)
  const recordMac = macFor({
    licenseId: payload.lid, token, status: 'active', expiryAt,
    hwid: payload.hwid ?? null, parentLicenseId: payload.plid ?? null, mechanicId: null,
  })

  // Plafond ATOMIQUE (§4). Sur PostgreSQL (multi-instance) un verrou consultatif
  // transactionnel, indexé sur le garage, sérialise les créations concurrentes :
  // deux requêtes simultanées ne peuvent plus toutes deux passer count() puis
  // create() (course TOCTOU sur le plafond). Sur SQLite (desktop mono-poste) la
  // transaction sérialise déjà les écritures. La contrainte UNIQUE(licenseId)
  // protège en dernier ressort contre un doublon créé en concurrence (→ 409).
  let created: { licenseId: string; status: string; expiryAt: Date; mechanicHint: string | null; createdAt: Date }
  try {
    created = await prisma.$transaction(async (tx) => {
      if (isPostgresDatabase()) {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `gf:mechkeys:${garageId}`)
      }
      const count = await tx.licenseKey.count({ where: { garageId, licenseType: 'mechanic' } })
      if (count >= max) throw new MechanicKeyCapError(max)
      return tx.licenseKey.create({
        data: {
          licenseId: payload.lid,
          token,
          customerId: payload.cid,
          licenseType: 'mechanic',
          expiryAt,
          status: 'active',
          isAdmin: false,
          seats: 1,
          hwid: payload.hwid ?? null,
          garageId,
          parentLicenseId: payload.plid ?? null,
          mechanicHint: payload.mn ?? null,
          mechanicId: null,
          recordMac,
        },
        select: { licenseId: true, status: true, expiryAt: true, mechanicHint: true, createdAt: true },
      })
    })
  } catch (e) {
    if (e instanceof MechanicKeyCapError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    // Doublon créé en concurrence (contrainte UNIQUE licenseId — code Prisma P2002).
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: unknown }).code === 'P2002') {
      return NextResponse.json({ error: 'Cette clé est déjà enregistrée.' }, { status: 409 })
    }
    throw e
  }

  await logAudit({ action: 'create', entityType: 'License', entityId: created.licenseId, session, req })

  return NextResponse.json({ ...created, assigned: false }, { status: 201 })
})

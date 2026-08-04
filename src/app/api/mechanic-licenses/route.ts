export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { verifyLicenseToken } from '@/lib/license/verify'
import { macFor } from '@/lib/license/mechanic-admin'
import { logAudit } from '@/lib/audit'

const MAX_MECHANIC_KEYS = Number(process.env.GF_MAX_MECHANIC_KEYS ?? 20)

// GET /api/mechanic-licenses — liste des clés mécanicien du garage (OWNER/MANAGER).
// Le token complet n'est JAMAIS renvoyé ici (voir /[lid]/token, OWNER seul).
export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const garageId = session.user.garageId

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

  return NextResponse.json({ data, max: MAX_MECHANIC_KEYS, total: data.length })
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
  if (!parent || parent.garageId !== garageId || parent.licenseType === 'mechanic') {
    // Message neutre : ne pas confirmer l'existence d'une licence d'un autre garage.
    return NextResponse.json({ error: 'Licence garage parente introuvable pour ce garage.' }, { status: 400 })
  }

  // Doublon ?
  const existing = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })
  if (existing) {
    return NextResponse.json({ error: 'Cette clé est déjà enregistrée.' }, { status: 409 })
  }

  // Plafond de clés mécanicien par garage.
  const count = await prisma.licenseKey.count({ where: { garageId, licenseType: 'mechanic' } })
  if (count >= MAX_MECHANIC_KEYS) {
    return NextResponse.json({ error: `Nombre maximal de clés mécanicien atteint (${MAX_MECHANIC_KEYS}).` }, { status: 403 })
  }

  const expiryAt = new Date(payload.exp * 1000)
  const recordMac = macFor({
    licenseId: payload.lid, token, status: 'active', expiryAt,
    hwid: payload.hwid ?? null, parentLicenseId: payload.plid ?? null, mechanicId: null,
  })

  const created = await prisma.licenseKey.create({
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

  await logAudit({ action: 'create', entityType: 'License', entityId: created.licenseId, session, req })

  return NextResponse.json({ ...created, assigned: false }, { status: 201 })
})

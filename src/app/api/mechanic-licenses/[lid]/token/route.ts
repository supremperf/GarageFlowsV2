export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { logAudit } from '@/lib/audit'

// Leurre de hash pour un temps de comparaison constant même si le compte n'a pas
// de mot de passe (anti-énumération par timing) — même stratégie que authorize().
const DUMMY_HASH = bcrypt.hashSync('reauth-timing-guard', 10)

/** En-têtes anti-cache stricts : un token de licence ne doit JAMAIS être mis en cache. */
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.headers.set('Pragma', 'no-cache')
  return res
}

// POST /api/mechanic-licenses/[lid]/token   { password }
// §9 — Récupération PROTÉGÉE du token complet d'une clé mécanicien.
//  - POST (jamais GET) : le token ne transite JAMAIS dans une URL/QueryString,
//    n'est pas préchargé par le navigateur, ni conservé dans l'historique/les logs d'accès.
//  - Réservé au PROPRIétaire (permission mechanicLicense:copyToken).
//  - RÉAUTHENTIFICATION obligatoire : le mot de passe du propriétaire est
//    revérifié (bcrypt, temps constant) — une session volée ne suffit pas.
//  - Réponse en no-store/no-cache ; le token n'apparaît que dans le CORPS, jamais
//    dans un log (l'audit n'enregistre pas le token).
//  Note TOTP : les comptes STAFF n'ont pas de 2FA dans le modèle (seul PortalUser
//  en dispose) ; si une 2FA staff est ajoutée, exiger ici le code TOTP également.
export const POST = withAuth(async (req, { params }: { params: { lid: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'mechanicLicense:copyToken')) {
    return noStore(NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 }))
  }
  const garageId = session.user.garageId

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return noStore(NextResponse.json({ error: 'Requête invalide' }, { status: 400 }))
  }
  const password = typeof body.password === 'string' ? body.password : ''

  // ── Réauthentification (temps constant) ────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })
  const hash = user?.password || DUMMY_HASH
  const reauthOk = await bcrypt.compare(password, hash)
  if (!user || !reauthOk) {
    // Audit d'une tentative échouée (sans révéler la cause exacte).
    await prisma.mechanicActionAudit.create({
      data: {
        garageId, actorUserId: session.user.id, actorRole: session.user.role,
        targetMechanicId: null, licenseId: params.lid,
        action: 'token_copy_denied', targetType: 'LicenseKey', targetId: params.lid,
      },
    }).catch(() => {})
    return noStore(NextResponse.json({ error: 'Réauthentification requise.', code: 'REAUTH_REQUIRED' }, { status: 401 }))
  }

  const license = await prisma.licenseKey.findFirst({
    where: { licenseId: params.lid, garageId, licenseType: 'mechanic' },
    select: { licenseId: true, token: true, mechanicId: true },
  })
  if (!license) return noStore(NextResponse.json({ error: 'Clé introuvable.' }, { status: 404 }))

  await prisma.mechanicActionAudit.create({
    data: {
      garageId, actorUserId: session.user.id, actorRole: session.user.role,
      targetMechanicId: license.mechanicId ?? null, licenseId: license.licenseId,
      action: 'token_copied', targetType: 'LicenseKey', targetId: license.licenseId,
    },
  }).catch(() => {})
  // Audit métier — jamais le token dans les détails.
  await logAudit({ action: 'update', entityType: 'License', entityId: license.licenseId, session, req, details: { tokenCopied: true } })

  return noStore(NextResponse.json({ licenseId: license.licenseId, token: license.token }))
})

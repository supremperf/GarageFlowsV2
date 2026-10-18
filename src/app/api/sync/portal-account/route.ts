import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/portal-account — publication POSTE → CLOUD d'un accès client.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 * « Ouvrir un accès » créait un `PortalUser` dans le SQLite du POSTE, puis
 * affichait « Accès prêt — communiquez le mot de passe maintenant » et envoyait
 * au client un lien vers `app.garageflows.fr`. Or aucune route ne répliquait ce
 * compte : le portail cherche l'identifiant dans la base du CLOUD, et le serveur
 * du poste n'écoute que sur 127.0.0.1. Le garagiste lisait donc à voix haute un
 * mot de passe pour un service qui ne le connaîtrait jamais, sans aucun moyen de
 * comprendre le refus de connexion de son client.
 *
 * ── Ce qui transite ─────────────────────────────────────────────────────────
 * Le HACHÉ bcrypt, jamais le mot de passe en clair : celui-ci ne quitte pas la
 * réponse rendue une seule fois au garage. Le cloud reçoit donc exactement ce
 * qu'il doit stocker, rien de plus.
 *
 * `clientId` est forcé à `null` : la fiche client n'est pas publiée, et pointer
 * vers un identifiant absent créerait une clé étrangère pendante. Le compte
 * portail n'en a pas besoin — la colonne est optionnelle des deux côtés.
 *
 * ── Garanties ───────────────────────────────────────────────────────────────
 *   · identité par licence GARAGE GF2 ; `garageId` issu de la LICENCE, jamais du
 *     corps (GF31-AUD-003) ;
 *   · l'identifiant du poste est réutilisé tel quel comme identifiant cloud —
 *     même convention que les devis et les factures ;
 *   · une adresse déjà prise dans CE garage par un AUTRE compte est refusée, pas
 *     écrasée : ce serait voler l'accès d'un client qui s'était inscrit seul ;
 *   · `revoquerAppareils` coupe les sessions ouvertes — une réinitialisation ou
 *     une désactivation qui laisserait un cookie valide ne couperait rien.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

const chaine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', `portal-account:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/portal-account] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string

  const compte = (body.account ?? {}) as Record<string, unknown>
  const id = chaine(compte.id)
  const email = chaine(compte.email)?.toLowerCase()
  const passwordHash = chaine(compte.passwordHash)
  if (!id || !email || !passwordHash) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  try {
    // L'adresse est-elle déjà prise, dans ce garage, par un AUTRE compte ?
    // Écraser reviendrait à s'approprier l'accès d'un client inscrit par
    // lui-même — et à lui couper le sien sans qu'il comprenne pourquoi.
    const homonyme = await prisma.portalUser.findFirst({
      where: { garageId, email, NOT: { id } },
      select: { id: true },
    })
    if (homonyme) {
      return NextResponse.json(
        { ok: false, code: 'EMAIL_TAKEN_CLOUD',
          message: 'Un accès en ligne existe déjà avec cette adresse pour ce garage.' },
        { status: 409 },
      )
    }

    const etat = {
      email,
      passwordHash,
      name: chaine(compte.name) ?? null,
      emailVerified: compte.emailVerified === true,
      mustChangePassword: compte.mustChangePassword === true,
      disabledAt: date(compte.disabledAt),
      passwordChangedAt: date(compte.passwordChangedAt),
      // Un compte qui vient d'être (ré)ouvert ne doit pas hériter du verrouillage
      // par échecs de connexion accumulé côté cloud.
      failedLoginCount: 0,
      lockedUntil: null,
      // La fiche client n'est pas publiée : aucun lien à établir.
      clientId: null,
    }

    await prisma.$transaction(async (tx) => {
      await tx.portalUser.upsert({
        where: { id },
        create: { id, garageId, ...etat },
        // `garageId` n'est PAS modifiable : un compte ne change jamais de garage.
        update: etat,
      })
      if (body.revoquerAppareils === true) {
        await tx.portalDevice.updateMany({
          where: { portalUserId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
    })

    logger.info('[sync/portal-account] accès publié', { garage: shortId(garageId), compte: shortId(id) })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}

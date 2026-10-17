import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/quote — publication POSTE → CLOUD d'un devis, puis émission du
 * lien de signature.
 *
 * ── Pourquoi cette route existe ──────────────────────────────────────────────
 * Un poste installé ne pouvait pas faire signer un devis à distance
 * (SIGNATURE_DISTANTE_INDISPONIBLE, GF-003) pour deux raisons cumulées :
 *
 *   1. le devis n'était répliqué NULLE PART — la passerelle /api/sync/* ne
 *      portait que les interventions, les photos, les mécaniciens et
 *      l'instantané portail ;
 *   2. le jeton était signé avec le secret D'INSTALLATION du poste, que le
 *      cloud ignore — et lui distribuer GF_PORTAL_SECRET reviendrait à poser le
 *      secret du portail sur chaque machine de garage.
 *
 * Le poste ne forge donc PAS le jeton : il publie le devis par le canal licence
 * déjà en place, et c'est le CLOUD — seul détenteur de son secret — qui émet le
 * lien. Aucun secret ne descend vers le poste.
 *
 * ── Garanties ────────────────────────────────────────────────────────────────
 * Identiques aux autres endpoints de synchronisation :
 *   · preuve d'identité par licence GARAGE GF2 signée (ECDSA P-256) ;
 *   · `garageId` issu de la LICENCE, jamais d'un champ de la requête ;
 *   · IDEMPOTENT : republier le même devis le met à jour, n'en crée pas un
 *     second — l'identifiant du poste est réutilisé tel quel comme identifiant
 *     cloud, comme pour les interventions ;
 *   · TRANSACTIONNEL : devis et lignes sont écrits ensemble ou pas du tout, de
 *     sorte qu'un devis ne puisse jamais s'afficher avec les lignes du
 *     précédent envoi ;
 *   · aucun écrasement silencieux : un devis appartenant à un autre garage, ou
 *     un numéro déjà pris par un autre devis, sont REFUSÉS explicitement.
 *
 * ── Ce qui n'est PAS publié, et pourquoi ─────────────────────────────────────
 * Ni `Client`, ni `Vehicle`. Le modèle `Quote` embarque déjà l'instantané utile
 * (`clientName`, `clientEmail`, `vehicleModel`, `licensePlate`…) : c'est lui que
 * le portail affiche. Publier les fiches complètes exporterait vers le cloud des
 * données personnelles dont la signature n'a aucun besoin. Les clés étrangères
 * correspondantes sont donc mises à NULL côté cloud — elles pointeraient sinon
 * vers des lignes inexistantes.
 */
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { portalSecret } from '@/lib/portal-secret'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortail } from '@/lib/portal/routes'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/** Durée de validité du lien remis au client. Identique à la voie cloud. */
const VALIDITE = '7d'
const VALIDITE_MS = 7 * 24 * 3600 * 1000

/** Statuts depuis lesquels un devis peut encore être signé. */
const SIGNABLES = new Set(['draft', 'sent'])

/** Bornes de saisie — un poste compromis ne doit pas pouvoir gonfler la base. */
const MAX_LIGNES = 200

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : ''
const strOrNull = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  return s === '' ? null : s
}
/** Entier monétaire : refuse NaN, décimaux et valeurs aberrantes. */
const entier = (v: unknown, defaut = 0): number =>
  Number.isSafeInteger(v) ? (v as number) : defaut

async function handlePOST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
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
    logger.warn('[sync/quote] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string

  // ── Validation de la charge utile ───────────────────────────────────────────
  const q = (body.quote ?? {}) as Record<string, unknown>
  const id = str(q.id, 64)
  const number = str(q.number, 64)
  const status = str(q.status, 32)
  const issueDate = str(q.issueDate, 10)
  if (!id || !number || !issueDate) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!SIGNABLES.has(status)) {
    // Un devis accepté, refusé ou converti n'a plus à être signé : republier
    // n'aurait aucun sens et rouvrirait un document clos.
    return NextResponse.json({ ok: false, code: 'QUOTE_NOT_SIGNABLE' }, { status: 409 })
  }

  const lignesBrutes = Array.isArray(body.lines) ? body.lines : []
  if (lignesBrutes.length > MAX_LIGNES) {
    return NextResponse.json({ ok: false, code: 'TOO_MANY_LINES' }, { status: 422 })
  }
  const lignes = lignesBrutes.map((l, i) => {
    const o = (l ?? {}) as Record<string, unknown>
    return {
      id: str(o.id, 64) || undefined,
      description: str(o.description, 500),
      // Montants recopiés VERBATIM : ce sont des entiers exacts (dix-millièmes
      // d'euro). Le cloud ne recalcule rien — toute conversion ici ferait
      // diverger le montant affiché au client de celui du poste.
      quantityTenThousandths: entier(o.quantityTenThousandths, 10000),
      unitPriceTenThousandths: entier(o.unitPriceTenThousandths, 0),
      unitCostTenThousandths: entier(o.unitCostTenThousandths, 0),
      isLabor: o.isLabor === true,
      sortOrder: entier(o.sortOrder, i),
    }
  })

  try {
    // ── Refus d'écrasement : le devis existe-t-il ailleurs ? ─────────────────
    const existant = await prisma.quote.findUnique({
      where: { id }, select: { id: true, garageId: true },
    })
    if (existant && existant.garageId !== garageId) {
      logger.warn('[sync/quote] refus — devis d’un autre garage', { quote: shortId(id) })
      return NextResponse.json({ ok: false, code: 'QUOTE_FOREIGN_GARAGE' }, { status: 409 })
    }

    // `@@unique([garageId, number])` : un AUTRE devis portant déjà ce numéro
    // ferait échouer l'écriture avec une erreur Prisma opaque. On le dit.
    const homonyme = await prisma.quote.findFirst({
      where: { garageId, number, id: { not: id } }, select: { id: true },
    })
    if (homonyme) {
      return NextResponse.json({ ok: false, code: 'QUOTE_NUMBER_TAKEN' }, { status: 409 })
    }

    // L'intervention liée n'est conservée que si elle existe RÉELLEMENT côté
    // cloud (elle y arrive par /api/sync/jobs). Sinon la clé étrangère
    // pointerait dans le vide.
    const jobIdBrut = strOrNull(q.jobId, 64)
    const jobId = jobIdBrut
      ? (await prisma.job.findFirst({ where: { id: jobIdBrut, garageId }, select: { id: true } }))?.id ?? null
      : null

    const donnees = {
      number,
      garageId,
      // Fiches non publiées : voir l'en-tête. On ne laisse pas de clé pendante.
      clientId: null,
      vehicleId: null,
      jobId,
      clientName: str(q.clientName, 200),
      clientEmail: strOrNull(q.clientEmail, 200),
      clientPhone: strOrNull(q.clientPhone, 50),
      clientAddress: strOrNull(q.clientAddress, 500),
      vehicleModel: strOrNull(q.vehicleModel, 200),
      licensePlate: strOrNull(q.licensePlate, 32),
      status,
      issueDate,
      validUntil: strOrNull(q.validUntil, 10),
      notes: strOrNull(q.notes, 5000),
      taxRate: typeof q.taxRate === 'number' && Number.isFinite(q.taxRate) ? q.taxRate : 20,
    }

    // ── Écriture atomique : devis + lignes, ensemble ou pas du tout ───────────
    await prisma.$transaction(async (tx) => {
      if (existant) {
        await tx.quote.updateMany({ where: { id, garageId }, data: donnees as never })
      } else {
        await tx.quote.create({ data: { ...donnees, id } as never })
      }
      // Les lignes sont REMPLACÉES : une ligne supprimée sur le poste doit
      // disparaître du devis que lit le client, pas y survivre.
      await tx.quoteLine.deleteMany({ where: { quoteId: id } })
      if (lignes.length) {
        await tx.quoteLine.createMany({
          data: lignes.map((l) => ({ ...l, quoteId: id })) as never,
        })
      }
    })

    // ── Émission du lien — par le cloud, avec SON secret ─────────────────────
    const token = await new SignJWT({ quoteId: id, typ: 'quote-sign', garageId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(VALIDITE)
      .sign(portalSecret())

    logger.info('[sync/quote] devis publié', {
      garage: shortId(garageId), quote: shortId(id), lignes: lignes.length,
    })

    return NextResponse.json({
      ok: true,
      url: publicUrlFor(cheminPortail(`quote/${token}`)),
      expiresAt: new Date(Date.now() + VALIDITE_MS).toISOString(),
    })
  } catch (err) {
    throw err
  }
}

export async function POST(req: Request) {
  return licenseApiBoundary(() => handlePOST(req))
}

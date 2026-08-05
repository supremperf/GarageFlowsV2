export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/licenses/create
 *
 * Enregistre une licence DÉJÀ SIGNÉE (générée par le keygen) dans la base
 * serveur, pour que /api/license/activate, /license/check et la révocation la
 * connaissent. Utilisé par l'outil keygen (User-Agent GarageFlow-KeygenGUI).
 *
 * Auth : en-tête `x-gf-key` == GARAGEFLOW_API_KEY (comparaison à temps constant),
 * comme /api/admin/licenses/revoke-by-key — l'admin par cookie ne s'applique PAS
 * ici (le keygen n'a pas de session navigateur).
 *
 * Corps : { token }  — jeton GF2 signé ES256. Le token est VÉRIFIÉ
 * cryptographiquement (verifyLicenseToken) : impossible d'enregistrer une licence
 * forgée. Les champs (lid, cid, type, expiry, seats, hwid, plid mécanicien) sont
 * lus depuis le payload signé, jamais fabriqués côté requête.
 *
 * Réponses : 201 (créée), 409 (déjà enregistrée — le keygen le traite comme un
 * succès), 400 (token invalide/manquant), 403 (clé API), 500 (config/DB).
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { verifyLicenseToken } from '@/lib/license/verify'
import { computeRecordMac } from '@/lib/license/record-mac'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

/** Comparaison à temps constant (évite l'oracle de timing sur la clé API). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export async function POST(req: NextRequest) {
  // Défense en profondeur : limite le débit AVANT toute comparaison. Comme
  // revoke-by-key, on NE bloque PAS sur indisponibilité du backend (fail_closed)
  // — l'outillage de confiance authentifié par clé API forte doit pouvoir
  // enregistrer un lot de clés ; seule une vraie limite atteinte (429) rejette.
  const rl = await enforceRateLimit('admin', clientIpFrom(req))
  if (!rl.ok && rl.degraded !== 'fail_closed') return rateLimitResponse(rl)

  // Auth : x-gf-key == GARAGEFLOW_API_KEY (temps constant).
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''
  if (!serverApiKey || serverApiKey.length < 16) {
    console.error('[admin/licenses/create] GARAGEFLOW_API_KEY absente ou trop faible')
    return NextResponse.json(
      { error: 'Configuration serveur incomplète (GARAGEFLOW_API_KEY).' },
      { status: 500 },
    )
  }
  if (!apiKey || !safeEqual(apiKey, serverApiKey)) {
    return NextResponse.json({ error: 'Accès refusé — clé API invalide' }, { status: 403 })
  }

  // Corps : { token }
  let token: string
  try {
    const body = await req.json()
    token = String(body.token ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 })
  }

  // Vérification cryptographique du jeton (signature ES256 + expiration + type).
  const result = verifyLicenseToken(token)
  if (!result.valid || !result.payload) {
    return NextResponse.json({ error: result.reason ?? 'Licence invalide' }, { status: 400 })
  }
  const p = result.payload
  const isMechanic = result.isMechanic === true

  try {
    const existing = await prisma.licenseKey.findUnique({ where: { licenseId: p.lid } })
    if (existing) {
      // Idempotent : le keygen traite 409 comme « déjà enregistrée » = succès.
      return NextResponse.json(
        { ok: true, alreadyRegistered: true, licenseId: p.lid, status: existing.status },
        { status: 409 },
      )
    }

    // Lien parent + rattachement au garage (clé mécanicien). La FK parentLicenseId
    // → LicenseKey.licenseId et le garageId ne sont posés QUE si le garage parent
    // est déjà enregistré (sinon l'insertion serait refusée par les FK).
    //
    // En posant garageId = celui de la licence garage parente, la clé apparaît
    // IMMÉDIATEMENT dans « Paramètres › Accès mécanicien » du patron
    // (GET /api/mechanic-licenses filtre par garageId) et devient attribuable
    // (POST …/assign exige garageId), donc activable une fois attribuée. Sans
    // parent enregistré, l'activation retombe sur le `plid` SIGNÉ du token
    // (activate : record.parentLicenseId ?? payload.plid) — rien n'est perdu.
    let parentLicenseId: string | null = null
    let garageId: string | null = null
    if (isMechanic && typeof p.plid === 'string' && p.plid.length > 0) {
      const parent = await prisma.licenseKey.findUnique({
        where: { licenseId: p.plid },
        select: { licenseId: true, garageId: true, licenseType: true },
      })
      if (parent && parent.licenseType !== 'mechanic') {
        parentLicenseId = parent.licenseId
        garageId = parent.garageId ?? null
      }
    }

    const expiryAt = new Date(p.exp * 1000)
    const hwid = p.hwid ?? null
    // Le MAC couvre les champs stockés (parentLicenseId inclus s'il est posé) —
    // strictement cohérent avec verifyRecordMac lu à l'activation/au check.
    const recordMac = computeRecordMac({
      licenseId: p.lid,
      token,
      status: 'active',
      expiryAt,
      hwid,
      parentLicenseId,
      mechanicId: null, // attribué plus tard dans l'app (assign)
    })

    const record = await prisma.licenseKey.create({
      data: {
        licenseId:    p.lid,
        token,
        customerId:   p.cid,
        licenseType:  p.typ,
        expiryAt,
        status:       'active',
        isAdmin:      result.isAdmin === true,
        seats:        p.seats ?? 1,
        hwid,
        label:        isMechanic ? (p.mn ?? null) : null,
        mechanicHint: isMechanic ? (p.mn ?? null) : null,
        parentLicenseId,
        garageId, // clé mécanicien → garage du parent (visible côté patron)
        recordMac,
      },
    })

    return NextResponse.json(
      { ok: true, licenseId: record.licenseId, status: record.status, type: record.licenseType },
      { status: 201 },
    )
  } catch (err: unknown) {
    // Course à l'insertion (LID en double) : traiter comme déjà enregistrée.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ ok: true, alreadyRegistered: true, licenseId: p.lid }, { status: 409 })
    }
    // Ne jamais renvoyer le message d'erreur brut (fuite d'infos internes).
    console.error('[admin/licenses/create] erreur base de données')
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}

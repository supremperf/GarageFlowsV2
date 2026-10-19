export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/licenses/generate
 *
 * Server-side license generation — signs a new token with the private key.
 * The private key is loaded from GF_PRIVATE_KEY (base64 PEM), else keys/private.pem,
 * and MUST match the embedded public key (src/lib/license/issuer-key.ts) —
 * otherwise nothing is signed.
 *
 * Requires admin cookie.
 *
 * Body: { customerId, licenseType, years?, seats?, hwid?, label?, notes? }
 * Returns: { token, lid, customerId, licenseType, expiryAt, seats }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isAdminSession, adminSessionActor } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { computeRecordMac } from '@/lib/license/record-mac'
import { loadIssuerPrivateKey, describeIssuerKeyFailure } from '@/lib/license/issuer-key'

// ── Base64url helpers ─────────────────────────────────────────────────────────
function b64uEnc(buf: Buffer): string {
  return buf.toString('base64url')
}

// ── License token builder ──────────────────────────────────────────────────────
function buildToken(
  privKeyPem:  string,
  customerId:  string,
  licenseType: string,
  years:       number,
  seats:       number,
  hwid:        string | null,
  label:       string | null,
): { token: string; lid: string; expiryAt: Date } {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + years * 365 * 24 * 3600
  const lid = crypto.randomUUID()

  // Watermark
  const wm = b64uEnc(
    Buffer.from(JSON.stringify({ c: customerId, t: now, r: crypto.randomBytes(6).toString('hex'), l: label ?? '' }))
  )

  const payload: Record<string, unknown> = {
    lid, cid: customerId, typ: licenseType,
    iss: now, exp, seats,
    wm, ver: '2.0',
  }
  if (hwid) payload.hwid = hwid

  const header     = { alg: 'ES256', typ: 'GF-LIC', v: 2 }
  const headerB64  = b64uEnc(Buffer.from(JSON.stringify(header)))
  const payloadB64 = b64uEnc(Buffer.from(JSON.stringify(payload)))
  const sigInput   = `${headerB64}.${payloadB64}`

  const signer = crypto.createSign('SHA256')
  signer.update(sigInput)
  const sig     = signer.sign({ key: privKeyPem, format: 'pem' })
  const sigB64  = b64uEnc(sig)

  return {
    token:    `GF2.${headerB64}.${payloadB64}.${sigB64}`,
    lid,
    expiryAt: new Date(exp * 1000),
  }
}

// ── Admin guard ────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['trial', 'premium', 'enterprise', 'admin'])

export async function POST(req: NextRequest) {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Limitation de débit (GF-DUR-045). C'est LA route qui signe avec la clé
  // privée : ses quatre voisines de `admin/licenses/*` en portaient une, pas
  // elle. Une session admin volée pouvait donc émettre des licences en rafale,
  // et chacune reste valable jusqu'à révocation individuelle.
  const rl = await enforceRateLimit('admin', `license-generate:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  // La clé est VÉRIFIÉE contre la clé publique embarquée avant toute signature :
  // une clé qui n'est pas celle de production émettrait des licences que
  // l'application refuse (même règle que le keygen, KEY_MISMATCH…).
  const issuer = loadIssuerPrivateKey()
  if (!issuer.ok) {
    if (issuer.reason === 'mismatch') {
      logger.error('[admin/generate] clé d’émission non conforme', {
        source: issuer.source,
        issuerFingerprint: issuer.issuerFingerprint,
        expectedFingerprint: issuer.expectedFingerprint,
      })
    }
    return NextResponse.json(
      { error: describeIssuerKeyFailure(issuer), code: `ISSUER_KEY_${issuer.reason.toUpperCase()}` },
      { status: 500 },
    )
  }
  const privKeyPem = issuer.pem

  let body: {
    customerId:  string
    licenseType: string
    years?:      number
    seats?:      number
    hwid?:       string | null
    label?:      string | null
    notes?:      string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  const { customerId, licenseType } = body
  if (!customerId || !licenseType) {
    return NextResponse.json({ error: 'customerId et licenseType sont requis' }, { status: 400 })
  }
  if (!VALID_TYPES.has(licenseType)) {
    return NextResponse.json({ error: `Type invalide: ${licenseType}` }, { status: 400 })
  }

  /**
   * Bornes des valeurs SIGNÉES (GF-DUR-045).
   *
   * `years` était borné [1, 10] ; `seats` ne l'était pas — `Math.max(1, …)`
   * n'a pas de plafond, n'exige pas un entier, et laisse passer un flottant,
   * une chaîne numérique ou `1e9`.
   *
   * Ce n'est pas une coquetterie de validation : la valeur part dans le PAYLOAD
   * SIGNÉ. Une licence est immuable une fois émise — un `seats` aberrant (faute
   * de frappe sur un formulaire d'administration, corps forgé avec un cookie
   * admin volé) ne se corrige qu'en révoquant la licence et en en réémettant
   * une, côté client compris. On refuse donc à l'émission plutôt que de signer
   * une valeur qu'on regrettera.
   *
   * Le plafond est délibérément large : il n'existe pas pour contrarier un
   * usage légitime, mais pour rendre l'absurde impossible.
   */
  const SEATS_MAX = 1000
  const years = Math.max(1, Math.min(10, Math.floor(Number(body.years ?? 1)) || 1))
  const seatsDemandes = Math.floor(Number(body.seats ?? 1))
  if (!Number.isFinite(seatsDemandes) || seatsDemandes < 1 || seatsDemandes > SEATS_MAX) {
    return NextResponse.json(
      { error: `Nombre de sièges invalide : attendu un entier entre 1 et ${SEATS_MAX}.` },
      { status: 400 },
    )
  }
  const seats = seatsDemandes
  const hwid  = body.hwid  ?? null
  const label = body.label ?? null

  let built: ReturnType<typeof buildToken>
  try {
    built = buildToken(privKeyPem, customerId, licenseType, years, seats, hwid, label)
  } catch (err: any) {
    logger.error('[admin/generate] signing error', err)
    const hint = err?.message?.includes('asn1')
      ? 'Format de clé invalide (attendu: PKCS8 PEM ECC P-256)'
      : 'Vérifiez que keys/private.pem est une clé ECC P-256 valide'
    return NextResponse.json({ error: `Erreur de signature — ${hint}` }, { status: 500 })
  }

  // Save to DB
  try {
    const recordMac = computeRecordMac({
      licenseId: built.lid,
      token:     built.token,
      status:    'active',
      expiryAt:  built.expiryAt,
      hwid,
    })
    const record = await prisma.licenseKey.create({
      data: {
        licenseId:   built.lid,
        token:       built.token,
        customerId,
        licenseType,
        expiryAt:    built.expiryAt,
        status:      'active',
        isAdmin:     licenseType === 'admin',
        seats,
        hwid,
        label,
        notes:       body.notes ?? null,
        recordMac,
      },
    })

    /**
     * TRACE DE L'ÉMISSION (GF-DUR-047).
     *
     * `[id]` journalisait ses transitions ; l'ÉMISSION, elle, ne laissait
     * aucune trace. C'est pourtant la seule opération qui engage la clé privée :
     * sans trace, une session admin volée pouvait signer des licences sans que
     * rien n'en garde mémoire — et l'exploitant n'aurait eu, pour tout indice,
     * que des lignes apparues en base sans auteur ni date d'acte.
     *
     * Ce qui est écrit : qui, quoi, quand, et les paramètres COMMERCIAUX. Jamais
     * le jeton, jamais la clé. Le jeton complet vit déjà dans `LicenseKey.token`
     * (il doit être affichable pour être remis au client) ; le redoubler dans un
     * journal ne ferait qu'élargir la surface de fuite.
     */
    await prisma.licenseDeviceEvent.create({
      data: {
        licenseId: built.lid,
        deviceId:  null, // événement de LICENCE, pas d'appareil
        action:    'issued',
        detail: JSON.stringify({
          actor:       (await adminSessionActor()) ?? 'admin',
          customerId,
          licenseType,
          seats,
          years,
          hwidLie:     Boolean(hwid),
          expiryAt:    built.expiryAt.toISOString(),
          at:          new Date().toISOString(),
        }),
      },
    }).catch((e) => {
      // Best-effort : une table d'audit indisponible ne doit pas annuler une
      // licence déjà signée ET enregistrée. Mais l'écart est SIGNALÉ.
      logger.error('[admin/generate] trace d’émission non écrite', e)
    })

    return NextResponse.json(record, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Licence déjà enregistrée (LID en double)' }, { status: 409 })
    }
    logger.error('[admin/generate] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

/**
 * POST /api/license/activate
 *
 * Server-side license validation using ECDSA-SHA256.
 * The private key NEVER leaves the server — the browser only submits a token.
 *
 * Flow:
 *  1. Rate-limit check (distribué en PWA, mémoire sous Electron)
 *  2. Cryptographic ECDSA signature verification (via verify.ts)
 *  3. DB revocation / suspension / expiry check
 *  4. Optional HWID binding check
 *  5. Enregistrement ATOMIQUE de l'appareil (plafond seats sous verrou) et
 *     émission d'un deviceToken (256 bits, haché en base, retourné UNE fois)
 *  6. Set signed session cookie + plain indicator cookies via Set-Cookie headers
 *
 * Body:    { license: string; hwid?: string; version?: string; os?: string; arch?: string; name?: string }
 * Returns: { ok, isAdmin?, licenseType?, expiryAt?, seats?, deviceToken?, deviceId?, reason?, code? }
 *
 * Politique d'erreur DB :
 *  - Electron (ELECTRON=1, SQLite locale) : fail-open documenté — l'application
 *    doit démarrer hors ligne ; le control plane distant reste l'autorité.
 *  - Serveur/PWA : FAIL-CLOSED — erreur interne générique 503, jamais de
 *    session émise sans vérifications réussies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyLicenseToken, verifyHwid, isValidHwidFormat } from '@/lib/license/verify'
import { prisma } from '@/lib/db'
import { computeRecordMac, verifyRecordMac } from '@/lib/license/record-mac'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { getAuthSecret } from '@/lib/auth-secret'
import {
  activateDevice,
  recordDeviceDenial,
  DeviceLimitError,
  DeviceRevokedError,
  InvalidHwidError,
} from '@/lib/license/devices'
import { logger } from '@/lib/logger'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5   // 5 years

const IS_ELECTRON = () => process.env.ELECTRON === '1'

function getJwtSecret(): Uint8Array {
  // No hard-coded fallback — a predictable secret would let anyone mint an admin session.
  return new TextEncoder().encode(getAuthSecret())
}

/** Erreur interne générique — aucun détail technique côté client. */
function internalError(): NextResponse {
  return NextResponse.json(
    { ok: false, code: 'SERVICE_UNAVAILABLE', reason: 'Service temporairement indisponible. Réessayez plus tard.' },
    { status: 503 },
  )
}

export async function POST(req: NextRequest) {
  // ── Step 0: Rate limiting ───────────────────────────────────────────────────
  // Distribué en production PWA (Upstash), mémoire sous Electron. Clé = IP
  // hachée — empêche la soumission de tokens en force brute.
  const rl = await enforceRateLimit('license_activate', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let licenseToken: string
  let clientHwid:   string | undefined
  let clientMeta:   { platform?: string; appVersion?: string; name?: string } = {}
  try {
    const body   = await req.json()
    licenseToken = String(body.license ?? '').trim()
    clientHwid   = body.hwid ? String(body.hwid) : undefined
    clientMeta = {
      platform:   body.os ? `${String(body.os)}${body.arch ? ` ${String(body.arch)}` : ''}` : undefined,
      appVersion: body.version ? String(body.version) : undefined,
      name:       body.name ? String(body.name) : undefined,
    }
  } catch {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', reason: 'Corps de requête invalide' },
      { status: 400 },
    )
  }

  if (!licenseToken) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', reason: 'Licence manquante' },
      { status: 400 },
    )
  }

  // ── Step 1: Cryptographic verification ─────────────────────────────────────
  const result = verifyLicenseToken(licenseToken)
  if (!result.valid || !result.payload) {
    return NextResponse.json({ ok: false, code: 'LICENSE_INVALID', reason: result.reason })
  }

  const { payload, isAdmin } = result

  // ── Step 2: DB check (revocation, expiry, HWID binding) ─────────────────────
  let seats = payload.seats ?? 1
  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId: payload.lid } })

    if (record) {
      // DB integrity check — detect SQLite tampering
      const mac = verifyRecordMac(record)
      if (mac.tampered) {
        logger.error('[license/activate] DB integrity check FAILED', { lid: record.licenseId })
        return NextResponse.json({
          ok: false, code: 'LICENSE_INVALID',
          reason: 'Erreur d\'intégrité de la base de données. Contactez le support.',
        })
      }

      // Revocation / suspension / expiry — la base (gérée par l'admin) prime.
      if (record.status === 'revoked') {
        return NextResponse.json({
          ok: false, code: 'LICENSE_REVOKED',
          reason: 'Cette licence a été révoquée. Contactez votre revendeur.',
        })
      }
      if (record.status === 'suspended') {
        return NextResponse.json({
          ok: false, code: 'LICENSE_SUSPENDED',
          reason: 'Cette licence est temporairement suspendue.',
        })
      }
      if (record.expiryAt.getTime() < Date.now()) {
        return NextResponse.json({
          ok: false, code: 'LICENSE_EXPIRED',
          reason: 'Cette licence a expiré. Contactez votre revendeur pour la renouveler.',
        })
      }
      seats = record.seats ?? payload.seats ?? 1

      // ── HWID binding — application STRICTE de la table de vérité ────────────
      // licence liée + HWID absent   → refus
      // licence liée + HWID invalide → refus
      // licence liée + HWID différent→ refus
      // licence liée + HWID identique→ autorisé
      // Aucun contournement silencieux : dès que le record porte un HWID, le
      // client DOIT présenter un HWID bien formé ET identique.
      if (record.hwid) {
        if (!clientHwid || !isValidHwidFormat(clientHwid)) {
          return NextResponse.json(
            { ok: false, code: 'HWID_REQUIRED', reason: 'Cette licence est liée à un matériel : identifiant matériel requis et valide.' },
            { status: 403 },
          )
        }
        if (!verifyHwid(record.hwid, clientHwid)) {
          return NextResponse.json(
            { ok: false, code: 'HWID_MISMATCH', reason: 'Cette licence est liée à un autre matériel.' },
            { status: 403 },
          )
        }
      }

      // Update last-seen timestamp
      await prisma.licenseKey.update({
        where: { id: record.id },
        data:  { lastSeenAt: new Date() },
      })
    } else {
      // First use — auto-register in DB with integrity MAC.
      // Si le TOKEN est lié à un matériel (payload.hwid), la machine qui
      // présente la licence doit correspondre AVANT tout enregistrement —
      // sinon un token volé s'auto-enregistrerait sur une autre machine.
      if (payload.hwid) {
        if (!clientHwid || !isValidHwidFormat(clientHwid) || !verifyHwid(payload.hwid, clientHwid)) {
          return NextResponse.json(
            { ok: false, code: 'HWID_MISMATCH', reason: 'Cette licence est liée à un matériel : activation refusée sur cet appareil.' },
            { status: 403 },
          )
        }
      }
      const expiryAt  = new Date(payload.exp * 1000)
      const hwid      = payload.hwid ?? null
      const recordMac = computeRecordMac({
        licenseId: payload.lid,
        token:     licenseToken,
        status:    'active',
        expiryAt,
        hwid,
      })
      await prisma.licenseKey.create({
        data: {
          licenseId:   payload.lid,
          token:       licenseToken,
          customerId:  payload.cid,
          licenseType: payload.typ,
          expiryAt,
          status:      'active',
          isAdmin:     isAdmin ?? false,
          seats:       payload.seats ?? 1,
          hwid,
          activatedAt: new Date(),
          lastSeenAt:  new Date(),
          recordMac,
        },
      })
    }
  } catch (err) {
    if (!IS_ELECTRON()) {
      // Serveur/PWA : FAIL-CLOSED — jamais de session sans vérifications réussies.
      logger.error('[license/activate] erreur DB (fail-closed serveur)', err)
      return internalError()
    }
    // Electron : fail-open documenté (démarrage hors ligne, base locale absente
    // à la première ouverture). Le control plane distant reste l'autorité.
    logger.warn('[license/activate] erreur DB locale (fail-open Electron)')
  }

  // ── Step 3: Enregistrement de l'appareil (si HWID fourni — client desktop) ──
  // ATOMIQUE : plafond `seats` appliqué sous verrou/transaction. Le deviceToken
  // est retourné UNE SEULE fois ; seul son HMAC est persisté.
  let deviceToken: string | undefined
  let deviceId:    string | undefined
  if (clientHwid && isValidHwidFormat(clientHwid)) {
    try {
      const activation = await activateDevice({
        licenseId: payload.lid,
        seats,
        hwid: clientHwid,
        ...clientMeta,
      })
      deviceToken = activation.deviceToken
      deviceId    = activation.deviceId
    } catch (err) {
      if (err instanceof DeviceLimitError) {
        await recordDeviceDenial(payload.lid, 'limit_denied')
        return NextResponse.json(
          {
            ok: false, code: 'DEVICE_LIMIT_REACHED',
            reason: `Nombre maximal d'appareils atteint pour cette licence (${seats}). Désactivez un appareil ou contactez votre revendeur.`,
          },
          { status: 403 },
        )
      }
      if (err instanceof DeviceRevokedError) {
        await recordDeviceDenial(payload.lid, 'revoked_denied')
        return NextResponse.json(
          { ok: false, code: 'DEVICE_REVOKED', reason: 'Cet appareil a été révoqué pour cette licence. Contactez votre revendeur.' },
          { status: 403 },
        )
      }
      if (err instanceof InvalidHwidError) {
        return NextResponse.json(
          { ok: false, code: 'VALIDATION_ERROR', reason: 'Identifiant matériel invalide.' },
          { status: 400 },
        )
      }
      if (!IS_ELECTRON()) {
        logger.error('[license/activate] enregistrement appareil impossible (fail-closed serveur)', err)
        return internalError()
      }
      // Electron : la base locale vient d'être refusée plus haut (fail-open) —
      // l'activation distante (control plane) fournira le jeton d'appareil.
      logger.warn('[license/activate] enregistrement appareil local impossible (fail-open Electron)')
    }
  }

  // ── Step 4: Build signed session JWT ────────────────────────────────────────
  // This JWT is stored HttpOnly and verified in middleware — prevents cookie tampering.
  const sessionJwt = await new SignJWT({ typ: payload.typ, lid: payload.lid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5y')
    .sign(getJwtSecret())

  // ── Step 5: Set cookies via response headers ────────────────────────────────
  const res = NextResponse.json({
    ok:          true,
    isAdmin:     isAdmin ?? false,
    licenseType: payload.typ,
    expiryAt:    new Date(payload.exp * 1000).toISOString(),
    seats,
    ...(deviceToken ? { deviceToken, deviceId } : {}),
  })

  // Attribut Secure hors Electron : en PWA (HTTPS), le JWT de session ne doit
  // jamais transiter sur un canal en clair. Sous Electron (127.0.0.1 en HTTP
  // local), Secure rendrait le cookie inopérant.
  const secure = IS_ELECTRON() ? '' : '; Secure'
  const base = `; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict${secure}`
  // Signed session token — tamper-proof (HS256 with NEXTAUTH_SECRET)
  res.headers.append('Set-Cookie', `gf_session=${sessionJwt}${base}; HttpOnly`)
  // Plain indicator cookies — used for UI state only, NOT for access control
  res.headers.append('Set-Cookie', `gf_license_validated=1${base}`)
  res.headers.append('Set-Cookie', `gf_license_type=${payload.typ}${base}`)

  return res
}

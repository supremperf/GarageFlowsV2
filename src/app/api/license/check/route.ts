import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/license/check
 * Heartbeat périodique — détecte révocations, suspensions, expirations et
 * appareils révoqués après l'activation initiale.
 *
 * Body:    { licenseId?: string; deviceToken?: string; hwid?: string; version?: string; os?: string; arch?: string }
 * Returns: { allowed: boolean; status?: string; reason?: string; deviceRequired?: boolean }
 *
 * Deux chemins :
 *  1. deviceToken présent → validation STRICTE : jeton haché retrouvé en base
 *     (comparaison à temps constant), appareil actif, HWID correspondant,
 *     licence active et non expirée. Jeton inconnu → { deviceRequired: true }
 *     (ré-activation), jamais un blocage à tort.
 *  2. deviceToken absent (anciens clients / première exécution) → contrôle de
 *     la licence par licenseId + indication deviceRequired pour que les clients
 *     récents obtiennent un jeton.
 *
 * Erreurs techniques : DB_UNAVAILABLE (503), SERVER_MISCONFIGURED (500),
 * INTERNAL_ERROR (500). Aucun succès implicite sur panne, sur toutes plateformes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyRecordMac, recordIntegrityUsable } from '@/lib/license/record-mac'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { validateDeviceToken, type DeviceTokenFailure } from '@/lib/license/devices'
import { isVersionSupported, seatlessCheckTolerated, parseClientPlatform, type ClientPlatform } from '@/lib/license/client-policy'
import { logger } from '@/lib/logger'

const IS_ELECTRON = () => process.env.ELECTRON === '1'

/** Réponse de blocage pour un échec de validation de jeton d'appareil. */
function deviceFailureResponse(code: DeviceTokenFailure): NextResponse {
  switch (code) {
    case 'device_unknown':
      // Jeton inconnu (rotation, base réinitialisée) : demander une ré-activation
      // — ce n'est PAS une révocation, ne jamais bloquer ici.
      return NextResponse.json({ allowed: true, status: 'unknown', deviceRequired: true })
    case 'device_revoked':
      return NextResponse.json({
        allowed: false, status: 'device_revoked',
        reason: 'Cet appareil a été révoqué pour cette licence.',
      })
    case 'device_hwid_mismatch':
      return NextResponse.json({
        allowed: false, status: 'device_hwid_mismatch',
        reason: 'Le jeton d\'appareil ne correspond pas à cette machine.',
      })
    case 'license_unknown':
      return NextResponse.json({ allowed: true, status: 'unknown', deviceRequired: true })
    case 'license_revoked':
      return NextResponse.json({
        allowed: false, status: 'revoked',
        reason: 'Cette licence a été révoquée.',
      })
    case 'license_suspended':
      return NextResponse.json({
        allowed: false, status: 'suspended',
        reason: 'Cette licence est temporairement suspendue.',
      })
    case 'license_tampered':
      return NextResponse.json({ allowed: false, status: 'tampered', code: 'LICENSE_TAMPERED' })
    case 'license_expired':
      return NextResponse.json({
        allowed: false, status: 'expired',
        reason: 'Cette licence a expiré.',
      })
  }
}

async function handlePOST(req: NextRequest) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let licenseId:   string
  let deviceToken: string
  let hwid:        string | undefined
  let installId:   string | undefined
  let version:     string | undefined
  let platform:    ClientPlatform
  try {
    const body  = await req.json()
    licenseId   = String(body.licenseId ?? '').trim()
    deviceToken = String(body.deviceToken ?? '').trim()
    hwid        = body.hwid ? String(body.hwid) : undefined
    // Identifiant d'installation PWA (navigateur) : lié à l'empreinte d'appareil
    // au heartbeat — sinon un jeton d'appareil volé serait rejouable depuis un
    // autre navigateur sans contrôle (voir validateDeviceToken).
    installId   = body.installId ? String(body.installId) : undefined
    version     = body.version ? String(body.version) : undefined
      // La plateforme vient de la REQUÊTE. La déduire de `process.env.ELECTRON`
      // côté serveur ne pouvait pas fonctionner : cette variable n'est jamais
      // positionnée sur le cloud, si bien que TOUT client Electron était classé
      // « unknown » et échappait à la politique de version (GF31-AUD-053).
      // `installId` reste un indice fiable de PWA quand rien n'est annoncé.
      const annoncee = parseClientPlatform(body.platform)
      platform    = annoncee !== 'unknown'
        ? annoncee
        : installId ? 'pwa' : IS_ELECTRON() ? 'electron' : 'unknown'
  } catch {
    return NextResponse.json(
      { allowed: false, code: 'VALIDATION_ERROR', reason: 'Requête invalide' },
      { status: 400 },
    )
  }

  // ── Politique de version : sous le minimum configuré → mise à jour requise ──
  if (!isVersionSupported(platform, version)) {
    return NextResponse.json(
      {
        allowed: false, status: 'upgrade_required', code: 'UPGRADE_REQUIRED',
        reason: 'Cette version de l\'application n\'est plus prise en charge. Mettez à jour.',
      },
      { status: 426 },
    )
  }

  // ── Chemin 1 : preuve d'appareil (clients récents) ──────────────────────────
  // La décision repose sur le RÉSULTAT de validateDeviceToken (preuve
  // cryptographique, révocation, liaison HWID), jamais sur la simple
  // présence du jeton fourni : l'omettre mène au chemin 2, refus par défaut.
  let validationAppareil: Awaited<ReturnType<typeof validateDeviceToken>> | null = null
  if (deviceToken) {
    try {
      validationAppareil = await validateDeviceToken(deviceToken, { hwid, installId })
    } catch (err) {
      throw err
    }
  }
  if (validationAppareil) {
    if (!validationAppareil.ok) return deviceFailureResponse(validationAppareil.code)

    // Jeton valide, licence active — bump lastSeenAt licence (best-effort).
    try {
      await prisma.licenseKey.update({
        where: { licenseId: validationAppareil.licenseId },
        data:  { lastSeenAt: new Date() },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ allowed: true, status: 'active' })
  }

  // ── Chemin 2 : SANS jeton d'appareil ────────────────────────────────────────
  // Un heartbeat sans jeton ne peut PAS accorder d'accès de façon durable (il
  // contournerait le contrôle des sièges). Il n'est toléré que pendant la
  // fenêtre de migration configurée (GF_DEVICE_AUTH_DEADLINE) ; en dehors, on
  // exige un jeton d'appareil (DEVICE_TOKEN_REQUIRED) — le client doit
  // (ré)activer pour en obtenir un.
  if (!licenseId) {
    return NextResponse.json(
      { allowed: false, code: 'VALIDATION_ERROR', reason: 'licenseId ou deviceToken requis' },
      { status: 400 },
    )
  }

  if (!seatlessCheckTolerated()) {
    // Défaut sûr : jeton d'appareil obligatoire. `deviceRequired:true` invite le
    // client à (ré)activer ; jamais allowed:true sans preuve d'appareil.
    return NextResponse.json({
      allowed: false, status: 'device_required', code: 'DEVICE_TOKEN_REQUIRED',
      deviceRequired: true,
      reason: 'Jeton d\'appareil requis. Réactivez votre licence.',
    })
  }

  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId } })

    if (!record) {
      // Not in DB yet — allowed (will be registered on next full activation)
      return NextResponse.json({ allowed: true, status: 'unknown', deviceRequired: true })
    }

    // DB integrity check — detect SQLite tampering.
    // Un MAC absent n'est pas un vestige tolérable mais le contournement le plus
    // simple de cette protection : refus, au même titre qu'un MAC invalide
    // (GF31-AUD-005). Remise en conformité d'un parc existant :
    // `scripts/repair-after-secret-rotation.js`.
    const mac = verifyRecordMac(record)
    if (!recordIntegrityUsable(mac)) {
      logger.error('[license/check] intégrité DB compromise', {
        cause: mac.missing ? 'mac-absent' : 'mac-invalide',
      })
      return NextResponse.json({
        allowed: false,
        status:  'tampered', code: 'LICENSE_TAMPERED',
        reason:  'Intégrité de la base de données compromise.',
      })
    }

    if (record.status === 'revoked') {
      return NextResponse.json({
        allowed: false,
        status:  'revoked',
        reason:  'Cette licence a été révoquée.',
      })
    }
    if (record.status === 'suspended') {
      return NextResponse.json({
        allowed: false,
        status:  'suspended',
        reason:  'Cette licence est temporairement suspendue.',
      })
    }
    if (record.expiryAt.getTime() < Date.now()) {
      return NextResponse.json({
        allowed: false,
        status:  'expired',
        reason:  'Cette licence a expiré.',
      })
    }

    // Still active — bump lastSeenAt
    await prisma.licenseKey.update({
      where: { id: record.id },
      data:  { lastSeenAt: new Date() },
    })

    // deviceRequired : les clients récents obtiennent un jeton d'appareil ;
    // les anciens ignorent ce champ et continuent sur le statut seul.
    return NextResponse.json({ allowed: true, status: 'active', deviceRequired: true })
  } catch (err) {
    throw err
  }
}

export async function POST(req: NextRequest) {
  return licenseApiBoundary(() => handlePOST(req))
}

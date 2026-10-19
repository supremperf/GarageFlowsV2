import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'

/**
 * POST /api/license/deactivate
 *
 * Auto-désactivation d'un appareil par le client qui détient son deviceToken :
 * libère le siège (status='deactivated') — la machine pourra se réactiver plus
 * tard si un siège est disponible. Ne révèle jamais si un jeton « existe » :
 * réponse identique pour jeton inconnu et jeton déjà inactif.
 *
 * Body:    { deviceToken: string }
 * Returns: { ok: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { deactivateByToken } from '@/lib/license/devices'


async function handlePOST(req: NextRequest) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let deviceToken: string
  try {
    const body  = await req.json()
    deviceToken = String(body.deviceToken ?? '').trim()
  } catch {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', reason: 'Requête invalide' },
      { status: 400 },
    )
  }
  if (!deviceToken) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION_ERROR', reason: 'deviceToken requis' },
      { status: 400 },
    )
  }

  try {
    // Réponse volontairement identique que le jeton soit inconnu ou déjà
    // inactif — pas d'oracle d'énumération de jetons.
    await deactivateByToken(deviceToken)
    return NextResponse.json({ ok: true })
  } catch (err) {
    throw err
  }
}

export async function POST(req: NextRequest) {
  return licenseApiBoundary(() => handlePOST(req))
}

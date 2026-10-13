export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/2fa/setup — begin 2FA enrolment (authenticated).
 * Returns a pending secret + otpauth URI + QR data URL to scan. The secret is
 * only activated once confirmed at /2fa/enable.
 */

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { generateTotpSecret, otpauthURL } from '@/lib/portal/totp'
import { protegerSecretTotp, peutProtegerSecretTotp } from '@/lib/portal/totp-storage'

export const POST = withPortalAuth(async (_req, { user }) => {
  if (user.twoFactorEnabled) return NextResponse.json({ error: 'Double authentification déjà activée' }, { status: 409 })

  // Fail-closed : sans clé de chiffrement, on REFUSE l'enrôlement plutôt que
  // d'écrire le secret en clair. Un repli silencieux donnerait au client un
  // second facteur qu'il croit protéger son compte, et qui ne le protège pas
  // (GF-DUR-022).
  if (!peutProtegerSecretTotp()) {
    return NextResponse.json(
      {
        error: 'La double authentification n’est pas disponible sur ce service (clé de chiffrement absente).',
        code: 'TWOFA_UNAVAILABLE',
      },
      { status: 503 },
    )
  }

  const secret = generateTotpSecret()
  await prisma.portalUser.update({
    where: { id: user.id },
    data: { twoFactorPending: protegerSecretTotp(secret) },
  })

  // Émetteur affiché dans l'app d'authentification. Le changement de libellé est
  // « forward-only » : les enrôlements TOTP existants (secret déjà partagé) restent
  // valides — l'issuer n'entre pas dans le calcul du code, seul le secret compte.
  const otpauth = otpauthURL({ secret, label: user.email, issuer: 'GarageFlows' })
  const qrDataUrl = await QRCode.toDataURL(otpauth)

  return NextResponse.json({ secret, otpauth, qrDataUrl })
})

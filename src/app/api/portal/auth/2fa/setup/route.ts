export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/2fa/setup — begin 2FA enrolment (authenticated).
 * Returns a pending secret + otpauth URI + QR data URL to scan. The secret is
 * only activated once confirmed at /2fa/enable.
 */

import { NextResponse } from 'next/server'
import { BRAND } from '@/config/brand'
import QRCode from 'qrcode'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { generateTotpSecret, otpauthURL } from '@/lib/portal/totp'
import { encryptTotpSecret } from '@/lib/portal/totp-crypto'

export const POST = withPortalAuth(async (_req, { user }) => {
  if (user.twoFactorEnabled) return NextResponse.json({ error: 'Double authentification déjà activée' }, { status: 409 })

  const secret = generateTotpSecret()
  // Chiffré au repos : le secret en clair n'est retourné qu'ici (QR d'enrôlement),
  // jamais stocké en clair ni relu ensuite.
  await prisma.portalUser.update({ where: { id: user.id }, data: { twoFactorPending: encryptTotpSecret(secret) } })

  const otpauth = otpauthURL({ secret, label: user.email, issuer: BRAND.productName })
  const qrDataUrl = await QRCode.toDataURL(otpauth)

  return NextResponse.json({ secret, otpauth, qrDataUrl })
})

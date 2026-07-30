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

export const POST = withPortalAuth(async (_req, { user }) => {
  if (user.twoFactorEnabled) return NextResponse.json({ error: 'Double authentification déjà activée' }, { status: 409 })

  const secret = generateTotpSecret()
  await prisma.portalUser.update({ where: { id: user.id }, data: { twoFactorPending: secret } })

  const otpauth = otpauthURL({ secret, label: user.email, issuer: 'GarageFlow' })
  const qrDataUrl = await QRCode.toDataURL(otpauth)

  return NextResponse.json({ secret, otpauth, qrDataUrl })
})

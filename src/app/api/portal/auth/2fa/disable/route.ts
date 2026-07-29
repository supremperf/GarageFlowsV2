export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/2fa/disable — turn off 2FA (authenticated, re-auth).
 * Body: { password }  — the account password is required to disable 2FA.
 */

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'

export const POST = withPortalAuth(async (req, { user }) => {
  if (!user.twoFactorEnabled) return NextResponse.json({ error: 'Double authentification non activée' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }
  const password = String(body.password ?? '')

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 })
  }

  await prisma.portalUser.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorPending: null, backupCodes: '[]' },
  })

  return NextResponse.json({ ok: true })
})

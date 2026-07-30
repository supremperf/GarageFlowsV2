export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/auth/verify-email?token=... — confirm a portal account's email.
 * The token was generated at registration and dispatched via the garage mailer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'Jeton manquant' }, { status: 400 })

  const user = await prisma.portalUser.findFirst({ where: { emailVerifyToken: token }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'Lien invalide ou déjà utilisé' }, { status: 400 })

  await prisma.portalUser.update({ where: { id: user.id }, data: { emailVerified: true, emailVerifyToken: null } })
  return NextResponse.json({ ok: true })
}

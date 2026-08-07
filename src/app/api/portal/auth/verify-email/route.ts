export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/auth/verify-email?token=... — confirm a portal account's email.
 * The token was generated at registration and dispatched via the garage mailer.
 *
 * C'est ICI — et seulement ici — que le rattachement à un Client existant du
 * garage (même email) est effectué : la possession de l'email vient d'être
 * prouvée par le clic sur le lien porteur du jeton. Le rattachement à
 * l'inscription est volontairement absent (anti-prise de contrôle de compte).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'Jeton manquant' }, { status: 400 })

  const user = await prisma.portalUser.findFirst({
    where: { emailVerifyToken: token },
    select: { id: true, garageId: true, email: true, clientId: true },
  })
  if (!user) return NextResponse.json({ error: 'Lien invalide ou déjà utilisé' }, { status: 400 })

  // Rattachement DIFFÉRÉ : email désormais prouvé → on peut lier le compte au
  // Client du même garage/email s'il existe et si le compte n'est pas déjà lié.
  let clientId = user.clientId
  if (!clientId) {
    const client = await prisma.client.findFirst({
      where: { garageId: user.garageId, email: user.email },
      select: { id: true },
    })
    clientId = client?.id ?? null
  }

  await prisma.portalUser.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null, ...(clientId ? { clientId } : {}) },
  })
  return NextResponse.json({ ok: true })
}

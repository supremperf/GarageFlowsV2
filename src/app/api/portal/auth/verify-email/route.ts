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
import { cheminPortail } from '@/lib/portal/routes'

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
  // Le client arrive ici depuis son logiciel de messagerie : lui répondre un
  // JSON brut serait un cul-de-sac. On le renvoie vers la connexion du portail,
  // EN PORTANT le slug de son garage — c'est le seul moment où le lien est
  // fabriqué côté serveur, donc le seul où la convention `?garage=<slug>` peut
  // être produite sans que personne ait à la connaître.
  const garage = await prisma.garage.findUnique({
    where: { id: user.garageId },
    select: { slug: true },
  })
  const connexion = cheminPortail('login')
  const cible = garage?.slug
    ? `${connexion}?garage=${encodeURIComponent(garage.slug)}&verified=1`
    : `${connexion}?verified=1`
  return NextResponse.redirect(new URL(cible, req.url), { status: 303 })
}

export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { SignJWT } from 'jose'
import { portalSecret } from '@/lib/portal-secret'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortailToken } from '@/lib/portal/routes'

// POST /api/portal/token  body: { jobId }
export const POST = withAuth(async (req: Request) => {
  const session = await requireSession()
  const { jobId } = await req.json()

  const job = await prisma.job.findFirst({
    where: { id: jobId, garageId: session.user.garageId },
    select: { id: true, customerName: true },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const token = await new SignJWT({ jobId, typ: 'portal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('48h')
    .sign(portalSecret())

  // Base PUBLIQUE officielle, jamais l'en-tête `Origin`.
  //
  // L'ancienne construction était `${req.headers.get('origin') ?? ''}/portal/…`.
  // `Origin` est fourni par le CLIENT : une requête portant `Origin:
  // https://exemple-malveillant.test` faisait renvoyer un lien de portail — jeton
  // d'accès inclus — pointant vers ce domaine. Le garage n'avait aucun moyen de
  // le voir : il copiait le lien et l'envoyait à son client, qui remettait le
  // jeton au tiers en le suivant. Sans en-tête `Origin` (le cas d'un appel
  // serveur à serveur), la même expression produisait un lien relatif inutilisable
  // dans un e-mail ou un SMS.
  const url = publicUrlFor(cheminPortailToken(token))
  return NextResponse.json({ token, url })
})

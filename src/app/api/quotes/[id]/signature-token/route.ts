export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { SignJWT } from 'jose'
import { portalSecret } from '@/lib/portal-secret'

// POST /api/quotes/[id]/signature-token
export const POST = withAuth(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, number: true, status: true },
  })
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
  if (!['draft', 'sent'].includes(quote.status)) {
    return NextResponse.json({ error: 'Ce devis ne peut plus être signé' }, { status: 409 })
  }

  const token = await new SignJWT({ quoteId: params.id, typ: 'quote-sign', garageId: session.user.garageId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(portalSecret())

  const url = `${req.headers.get('origin') ?? ''}/portal/quote/${token}`

  // Mark quote as sent if it was draft
  if (quote.status === 'draft') {
    await prisma.quote.update({ where: { id: params.id }, data: { status: 'sent' } })
  }

  return NextResponse.json({ token, url })
})

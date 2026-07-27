export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { verifyPortalToken } from '@/lib/portal-secret'

// GET — return quote data
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const payload = await verifyPortalToken(params.token)
    if (!payload || payload.typ !== 'quote-sign' || typeof payload.quoteId !== 'string') {
      return NextResponse.json({ error: 'Token invalide' }, { status: 403 })
    }

    const quote = await prisma.quote.findUnique({
      where: { id: payload.quoteId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        garage: { select: { name: true, phone: true, email: true, address: true, siret: true, logoBase64: true, logoPath: true, taxRate: true, invoiceFooter: true } },
      },
    })
    if (!quote) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const totalHT  = roundCents(calcTotalHT(quote.lines))
    const totalTTC = roundCents(calcTotalTTC(quote.lines, quote.taxRate))
    const alreadySigned = ['accepted', 'refused', 'converted'].includes(quote.status)

    return NextResponse.json({ ...quote, totalHT, totalTTC, alreadySigned })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}

// POST — sign (accept or refuse)
export async function POST(req: Request, { params }: { params: { token: string } }) {
  try {
    const payload = await verifyPortalToken(params.token)
    if (!payload || payload.typ !== 'quote-sign' || typeof payload.quoteId !== 'string') {
      return NextResponse.json({ error: 'Token invalide' }, { status: 403 })
    }

    const { action } = await req.json()  // 'accept' | 'refuse'
    if (!['accept', 'refuse'].includes(action)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
    }

    const quote = await prisma.quote.findUnique({ where: { id: payload.quoteId } })
    if (!quote) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    if (['accepted', 'refused', 'converted'].includes(quote.status)) {
      return NextResponse.json({ error: 'Ce devis a déjà été traité' }, { status: 409 })
    }

    const newStatus = action === 'accept' ? 'accepted' : 'refused'
    await prisma.quote.update({ where: { id: payload.quoteId }, data: { status: newStatus } })

    return NextResponse.json({ ok: true, status: newStatus })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}

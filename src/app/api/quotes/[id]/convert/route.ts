export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'

/** Sentinel thrown inside the transaction when the quote is already converted. */
class AlreadyConvertedError extends Error {}

// POST /api/quotes/[id]/convert  — converts a quote to an invoice
export const POST = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (quote.status === 'converted') {
    return NextResponse.json({ error: 'Devis déjà converti' }, { status: 400 })
  }

  // Counter increment, invoice creation and quote update run in ONE transaction,
  // gated by an ATOMIC status claim: updateMany flips 'converted' only if it is
  // not already converted. If two requests race (double-click), exactly one gets
  // count===1; the loser throws → 409, so a single quote can never spawn two
  // legal invoices. @@unique([quoteId]) on Invoice is the DB backstop.
  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const claim = await tx.quote.updateMany({
        where: { id: quote.id, garageId, status: { not: 'converted' } },
        data: { status: 'converted' },
      })
      if (claim.count === 0) throw new AlreadyConvertedError()

      const garage = await tx.garage.update({
        where: { id: garageId },
        data: { invoiceCounter: { increment: 1 } },
      })
      const issueDate = format(new Date(), 'yyyy-MM-dd')
      const year = new Date(issueDate).getFullYear()
      const number = `${garage.invoicePrefix}-${year}-${String(garage.invoiceCounter).padStart(3, '0')}`

      const inv = await tx.invoice.create({
        data: {
          number,
          garageId,
          clientId: quote.clientId,
          vehicleId: quote.vehicleId,
          jobId: quote.jobId,
          quoteId: quote.id,
          clientName: quote.clientName,
          clientEmail: quote.clientEmail,
          clientPhone: quote.clientPhone,
          clientAddress: quote.clientAddress,
          vehicleModel: quote.vehicleModel,
          licensePlate: quote.licensePlate,
          status: 'draft',
          issueDate,
          notes: quote.notes,
          taxRate: quote.taxRate,
          lines: {
            create: quote.lines.map(l => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              unitCost: l.unitCost,
              isLabor: l.isLabor,
              sortOrder: l.sortOrder,
            })),
          },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })

      await tx.quote.update({
        where: { id: quote.id },
        data: { invoiceId: inv.id },
      })
      return inv
    })

    return NextResponse.json(invoice, { status: 201 })
  } catch (e) {
    if (e instanceof AlreadyConvertedError) {
      return NextResponse.json({ error: 'Devis déjà converti' }, { status: 409 })
    }
    throw e
  }
})

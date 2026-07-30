export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'

// POST /api/quotes/[id]/convert  — converts a quote to an invoice
// Atomique (une seule transaction) + idempotent : deux conversions concurrentes
// ne peuvent pas produire deux factures ni un double numéro (anti-TOCTOU).
export const POST = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: params.id, garageId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })
      if (!quote) throw new ConvertError(404, 'Quote not found')
      if (quote.status === 'converted') throw new ConvertError(400, 'Devis déjà converti')

      const garage = await tx.garage.update({
        where: { id: garageId },
        data: { invoiceCounter: { increment: 1 } },
      })
      const year = new Date().getFullYear()
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
          issueDate: format(new Date(), 'yyyy-MM-dd'),
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

      // Claim atomically: only convert if still not converted (guards concurrency).
      const claim = await tx.quote.updateMany({
        where: { id: quote.id, garageId, status: { not: 'converted' } },
        data: { status: 'converted', invoiceId: inv.id },
      })
      if (claim.count === 0) throw new ConvertError(400, 'Devis déjà converti')

      return inv
    })

    return NextResponse.json(invoice, { status: 201 })
  } catch (err) {
    if (err instanceof ConvertError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
})

class ConvertError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'

// POST /api/quotes/[id]/convert  — converts a quote to an invoice
export const POST = withAuth(async (_req, { params }) => {
  const session = await requireSession()

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (quote.status === 'converted') {
    return NextResponse.json({ error: 'Devis déjà converti' }, { status: 400 })
  }

  // Auto-increment invoiceCounter
  const garage = await prisma.garage.update({
    where: { id: session.user.garageId },
    data: { invoiceCounter: { increment: 1 } },
  })
  const year = new Date().getFullYear()
  const number = `${garage.invoicePrefix}-${year}-${String(garage.invoiceCounter).padStart(3, '0')}`

  const invoice = await prisma.invoice.create({
    data: {
      number,
      garageId: session.user.garageId,
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

  // Mark quote as converted
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: 'converted', invoiceId: invoice.id },
  })

  return NextResponse.json(invoice, { status: 201 })
})

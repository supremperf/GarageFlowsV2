export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can, redactLineCosts } from '@/lib/authz'
import { format } from 'date-fns'
import { withTotals } from '@/lib/billing'
import { linesToEuros } from '@/lib/money-db'
import { logAudit } from '@/lib/audit'

// POST /api/quotes/[id]/convert  — converts a quote to an invoice
// Atomique (une seule transaction) + idempotent : deux conversions concurrentes
// ne peuvent pas produire deux factures ni un double numéro (anti-TOCTOU).
export const POST = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  // La conversion ÉMET une facture : elle relève donc de `invoice:manage`, et
  // non du seul `quote:manage`. Sans cela, le contrôle posé sur POST
  // /api/invoices se contournait en convertissant un devis (GF31-AUD-009).
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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
              // Copie VERBATIM des entiers exacts (aucune conversion, zéro perte).
              quantityTenThousandths: l.quantityTenThousandths,
              unitPriceTenThousandths: l.unitPriceTenThousandths,
              unitCostTenThousandths: l.unitCostTenThousandths,
              isLabor: l.isLabor,
              sortOrder: l.sortOrder,
              // Le lien vers la pièce SUIT le devis jusqu'à la facture. La
              // facture naît en « draft » : aucun mouvement de stock ici. Le
              // décrément unique aura lieu à SA validation — jamais deux fois
              // (une fois au devis puis une fois à la facture).
              partId: l.partId,
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

    // La conversion est la voie de création de facture la plus utilisée, et la
    // SEULE qui n'écrivait rien au journal d'audit : impossible de déterminer
    // qui avait émis une facture issue d'un devis, alors que ce journal est le
    // mécanisme de responsabilité de l'application (GF31-AUD-048).
    await logAudit({
      action: 'create',
      entityType: 'Invoice',
      entityId: invoice.id,
      session,
      req: _req,
      details: { number: invoice.number, fromQuoteId: params.id, via: 'quote-conversion' },
    })

    // MÊME projection que GET/PATCH des factures — voir le commentaire détaillé
    // dans src/app/api/invoices/route.ts. La facture issue d'une conversion est
    // consommée par le même composant client que celle créée directement.
    return NextResponse.json(withTotals({ ...invoice, lines: redactLineCosts(linesToEuros(invoice.lines), session.user.role) }), { status: 201 })
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

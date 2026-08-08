export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { format } from 'date-fns'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { CreateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { assertRelations } from '@/lib/tenant'

// GET /api/invoices
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const status = searchParams.get('status')

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const skip  = (page - 1) * limit

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (jobId) where.jobId = jobId
  if (status) where.status = status

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  // Compute totals from lines (no stored computed columns in SQLite)
  const data = invoices.map(inv => {
    return withTotals({ ...inv, lines: linesToEuros(inv.lines) })
  })
  return NextResponse.json({ data, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/invoices
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateInvoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // SECURITY (IDOR): les FK fournies doivent appartenir au garage de la session.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'client', id: body.clientId, label: 'Client' },
    { model: 'vehicle', id: body.vehicleId, label: 'Véhicule' },
    { model: 'job', id: body.jobId, label: 'Intervention' },
  ])
  if (relErr) return relErr

  const year = new Date().getFullYear()

  // Réservation du numéro ET création du document dans UNE SEULE transaction :
  // si la création échoue, l'incrément du compteur est annulé (pas de trou de
  // séquence). La contrainte unique @@unique([garageId, number]) protège en plus
  // contre tout doublon.
  let invoice
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.update({
        where: { id: session.user.garageId },
        data: { invoiceCounter: { increment: 1 } },
      })
      const number = `${garage.invoicePrefix}-${year}-${String(garage.invoiceCounter).padStart(3, '0')}`
      return tx.invoice.create({
        data: {
          number,
          garageId: session.user.garageId,
          clientId: body.clientId ?? null,
          vehicleId: body.vehicleId ?? null,
          jobId: body.jobId ?? null,
          clientName: body.clientName ?? '',
          clientEmail: body.clientEmail ?? null,
          clientPhone: body.clientPhone ?? null,
          clientAddress: body.clientAddress ?? null,
          vehicleModel: body.vehicleModel ?? null,
          licensePlate: body.licensePlate ?? null,
          status: 'draft',
          issueDate: body.issueDate ?? format(new Date(), 'yyyy-MM-dd'),
          dueDate: body.dueDate ?? null,
          notes: body.notes ?? null,
          taxRate: body.taxRate ?? garage.taxRate,
          lines: {
            create: (body.lines ?? []).map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number }, i: number) => ({
              description: l.description,
              ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
              isLabor: l.isLabor ?? false,
              sortOrder: l.sortOrder ?? i,
            })),
          },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Numéro de facture déjà utilisé, réessayez' }, { status: 409 })
    }
    throw e
  }

  await logAudit({ action: 'create', entityType: 'Invoice', entityId: invoice.id, session, req })

  // MÊME projection que GET et PATCH. L'objet Prisma brut ne porte que les
  // entiers en dix-millièmes ; ses lignes n'ont ni `quantity`, ni `unitPrice`,
  // ni `unitCost` en euros, et le document n'a ni totalHT ni totalTTC.
  // Le client réinjecte cette réponse dans son état (setLines) puis affiche
  // `line.unitPrice.toFixed(2)` : sur la réponse brute, cela levait
  // « Cannot read properties of undefined (reading 'toFixed') » et la limite
  // d'erreur remplaçait TOUTE l'application — alors que la facture, elle,
  // était bien enregistrée.
  return NextResponse.json(withTotals({ ...invoice, lines: linesToEuros(invoice.lines) }), { status: 201 })
})

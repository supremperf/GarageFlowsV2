export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { redactLineCosts } from '@/lib/authz'
import { format } from 'date-fns'
import { CreateQuoteSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { assertRelations } from '@/lib/tenant'
import { collectPartIds, findForeignPartIds } from '@/lib/stock/invoice-stock'

// GET /api/quotes
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

  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.quote.count({ where }),
  ])

  const data = quotes.map(q => {
  // Coût d'achat retiré pour les rôles sans `financial:read` (GF31-AUD-009).
    return withTotals({ ...q, lines: redactLineCosts(linesToEuros(q.lines), session.user.role) })
  })
  return NextResponse.json({ data, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/quotes
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateQuoteSchema.safeParse(body)
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

  // SECURITY (IDOR) — une ligne ne peut référencer qu'une pièce de CE garage.
  const foreignParts = await findForeignPartIds(prisma, session.user.garageId, collectPartIds(parsed.data.lines))
  if (foreignParts.length > 0) {
    return NextResponse.json({ error: 'Pièce inconnue dans le stock de ce garage', code: 'PART_NOT_FOUND' }, { status: 400 })
  }

  const year = new Date().getFullYear()

  // Réservation du numéro + création dans UNE SEULE transaction (pas de trou de
  // séquence si la création échoue) ; unicité garantie par @@unique([garageId, number]).
  let quote
  try {
    quote = await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.update({
        where: { id: session.user.garageId },
        data: { quoteCounter: { increment: 1 } },
      })
      const number = `${garage.quotePrefix}-${year}-${String(garage.quoteCounter).padStart(3, '0')}`
      return tx.quote.create({
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
          validUntil: body.validUntil ?? null,
          notes: body.notes ?? null,
          taxRate: body.taxRate ?? garage.taxRate,
          lines: {
            create: (body.lines ?? []).map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number; partId?: string | null }, i: number) => ({
              description: l.description,
              ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
              isLabor: l.isLabor ?? false,
              sortOrder: l.sortOrder ?? i,
              // Un DEVIS n'engage JAMAIS le stock : le lien est conservé pour
              // être reporté sur la facture lors de la conversion, et c'est la
              // validation de CETTE facture qui décrémentera — une seule fois.
              partId: l.isLabor ? null : (l.partId ?? null),
            })),
          },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Numéro de devis déjà utilisé, réessayez' }, { status: 409 })
    }
    throw e
  }

  await logAudit({ action: 'create', entityType: 'Quote', entityId: quote.id, session, req })

  // MÊME projection que GET et PATCH — voir le commentaire détaillé dans
  // src/app/api/invoices/route.ts : sans elle, le client plante à l'affichage
  // du devis qu'il vient d'enregistrer (unitPrice absent → toFixed sur undefined).
  return NextResponse.json(withTotals({ ...quote, lines: redactLineCosts(linesToEuros(quote.lines), session.user.role) }), { status: 201 })
})

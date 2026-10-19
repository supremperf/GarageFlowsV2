export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { parsePagination } from '@/lib/pagination'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can, redactLineCosts } from '@/lib/authz'
import { format } from 'date-fns'
import { withTotals } from '@/lib/billing'
import { lineToScaled, linesToEuros } from '@/lib/money-db'
import { CreateInvoiceSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { assertRelations } from '@/lib/tenant'
import { collectPartIds, findForeignPartIds } from '@/lib/stock/invoice-stock'

// GET /api/invoices
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const status = searchParams.get('status')

  const pagination = parsePagination(searchParams, 20)
  if (!pagination) return NextResponse.json({ error: 'Pagination invalide', code: 'INVALID_PAGINATION' }, { status: 400 })
  const { page, limit, skip } = pagination

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
  // Coût d'achat retiré pour les rôles sans `financial:read` (GF31-AUD-009).
    return withTotals({ ...inv, lines: redactLineCosts(linesToEuros(inv.lines), session.user.role) })
  })
  return NextResponse.json({ data, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/invoices
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  // §16 — le contrôle d'accès appartient au serveur. La matrice `authz.ts`
  // réserve `invoice:manage` à MANAGER et OWNER (un RECEPTIONIST a
  // `quote:manage`, PAS `invoice:manage`) ; aucune route de facturation ne
  // l'appliquait, si bien que la matrice était purement déclarative sur le
  // document le plus sensible du produit (GF31-AUD-009). Pour ouvrir la
  // facturation à un autre rôle, modifier la MATRICE — pas cette route.
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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

  // SECURITY (IDOR) — une ligne ne peut référencer qu'une pièce de CE garage.
  // Contrôlé AVANT toute écriture : sans cela, un `partId` étranger serait
  // enregistré puis décrémenterait le stock d'un autre garage à la validation.
  const foreignParts = await findForeignPartIds(prisma, session.user.garageId, collectPartIds(parsed.data.lines))
  if (foreignParts.length > 0) {
    return NextResponse.json({ error: 'Pièce inconnue dans le stock de ce garage', code: 'PART_NOT_FOUND' }, { status: 400 })
  }

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
            create: (body.lines ?? []).map((l: { description: string; quantity: number; unitPrice: number; unitCost?: number; isLabor?: boolean; sortOrder?: number; partId?: string | null }, i: number) => ({
              description: l.description,
              ...lineToScaled(l), // saisie euros -> entiers exacts (dix-milliemes)
              isLabor: l.isLabor ?? false,
              sortOrder: l.sortOrder ?? i,
              // Lien interne vers la pièce du stock (validé ci-dessus). Une
              // facture créée ici est TOUJOURS en brouillon : aucun mouvement
              // de stock n'a lieu à la création.
              partId: l.isLabor ? null : (l.partId ?? null),
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
  return NextResponse.json(withTotals({ ...invoice, lines: redactLineCosts(linesToEuros(invoice.lines), session.user.role) }), { status: 201 })
})

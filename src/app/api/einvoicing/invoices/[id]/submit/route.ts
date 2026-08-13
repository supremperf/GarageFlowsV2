export const dynamic = 'force-dynamic'

/**
 * POST /api/einvoicing/invoices/[id]/submit — transmet une facture à la
 * plateforme agréée du garage.
 *
 * La facture est relue DEPUIS LA BASE, bornée au garage de la session : le
 * client ne fournit qu'un identifiant, jamais le contenu du document (§18).
 * L'idempotence est assurée par `submit.ts` : une même facture, inchangée, ne
 * peut pas partir deux fois, quel que soit le nombre de clics (§94).
 *
 * GET renvoie l'état de transmission connu pour cette facture.
 */

import { NextResponse } from 'next/server'
import { prisma, serverPrisma, isPostgresDatabase } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { linesToEuros } from '@/lib/money-db'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { envoyerFacture, declarerNonParvenue } from '@/lib/einvoicing/submit'

/** Statuts HTTP par cause d'échec — un rejet n'est pas une panne. */
const STATUT: Record<string, number> = {
  NO_CONNECTION: 409,
  CONNECTION_UNUSABLE: 503,
  NO_ADAPTER: 409,
  INVOICE_NOT_FOUND: 404,
  DOCUMENT_INVALID: 422,
  ALREADY_SUBMITTED: 409,
  PROVIDER_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 502,
}

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Émettre une facture réglementaire relève de la gestion de la facturation.
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Modèles réservés au déploiement serveur : refus explicite sur le poste.
  if (!isPostgresDatabase()) {
    return NextResponse.json(
      { error: 'La facturation électronique est gérée par le service en ligne, pas par le poste.', code: 'SERVER_ONLY' },
      { status: 501 },
    )
  }

  const flags = getEInvoicingFlags()
  if (!flags.outgoingEnabled) {
    return NextResponse.json(
      { error: "L'émission de factures électroniques est désactivée.", code: 'FEATURE_DISABLED' },
      { status: 409 },
    )
  }

  // Portée garage : une facture d'un autre garage est INTROUVABLE, pas refusée.
  const facture = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!facture) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  // Un brouillon n'est pas un document opposable : rien à transmettre. Une
  // facture ANNULÉE non plus — la déclarer à la plateforme agréée créerait une
  // créance que le garage a précisément retirée. Seul 'draft' était bloqué.
  const NON_TRANSMISSIBLES: Record<string, string> = {
    draft: 'Une facture en brouillon ne peut pas être transmise. Validez-la d’abord.',
    cancelled: 'Une facture annulée ne peut pas être transmise à la plateforme.',
  }
  const refus = NON_TRANSMISSIBLES[facture.status ?? 'draft']
  if (refus) {
    return NextResponse.json(
      { error: refus, code: facture.status === 'cancelled' ? 'INVOICE_CANCELLED' : 'INVOICE_DRAFT' },
      { status: 409 },
    )
  }

  // Sortie de l'impasse « issue inconnue » : l'exploitant a vérifié sur le
  // portail de sa plateforme que la facture n'y est pas, et le déclare. La
  // décision est tracée au journal d'audit, jamais déduite par le logiciel.
  const corps = await req.json().catch(() => ({} as Record<string, unknown>))
  if (corps?.action === 'declare-not-received') {
    const id = typeof corps.transmissionId === 'string' ? corps.transmissionId : ''
    if (!id) {
      return NextResponse.json({ error: 'transmissionId requis', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    const r = await declarerNonParvenue(session.user.garageId, id, session.user.id)
    return NextResponse.json(r, { status: r.ok ? 200 : (STATUT[r.code ?? ''] ?? 500) })
  }

  const garage = await prisma.garage.findUnique({ where: { id: session.user.garageId } })
  if (!garage) return NextResponse.json({ error: 'Garage introuvable' }, { status: 404 })

  const resultat = await envoyerFacture({
    garageId: session.user.garageId,
    invoiceId: facture.id,
    environment: flags.defaultEnvironment,
    garage: { name: garage.name, siret: garage.siret, vatNumber: garage.vatNumber, address: garage.address },
    invoice: {
      number: facture.number,
      issueDate: facture.issueDate,
      dueDate: facture.dueDate,
      taxRate: facture.taxRate,
      clientName: facture.clientName,
      clientAddress: facture.clientAddress,
    },
    lines: linesToEuros(facture.lines).map((l) => ({
      description: l.description,
      quantityTenThousandths: l.quantityTenThousandths,
      unitPriceTenThousandths: l.unitPriceTenThousandths,
    })),
    actorUserId: session.user.id,
  })

  if (!resultat.ok) {
    return NextResponse.json(resultat, { status: STATUT[resultat.code ?? ''] ?? 500 })
  }
  return NextResponse.json(resultat)
})

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  if (!isPostgresDatabase()) {
    return NextResponse.json(
      { error: 'La facturation électronique est gérée par le service en ligne, pas par le poste.', code: 'SERVER_ONLY' },
      { status: 501 },
    )
  }

  // Portée garage explicite : l'identifiant d'une facture ne suffit jamais.
  const transmissions = await serverPrisma().eInvoiceTransmission.findMany({
    where: { invoiceId: params.id, garageId: session.user.garageId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, providerId: true, environment: true, status: true,
      documentFormat: true, documentSha256: true, externalId: true,
      errorMessage: true, createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({ transmissions })
})

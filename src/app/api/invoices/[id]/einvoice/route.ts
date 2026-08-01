export const dynamic = 'force-dynamic'

/**
 * GET /api/invoices/[id]/einvoice?format=UBL|CII[&download=1]
 *
 * Génère la facture électronique (EN 16931) d'une facture existante : mappe la
 * facture + le garage émetteur vers le document normalisé, VALIDE (erreurs +
 * avertissements) et sérialise en UBL 2.1 ou CII (Factur-X).
 *
 * - JSON (défaut) : { document, validation, format, xml }
 * - download=1     : le XML brut (application/xml) en pièce jointe.
 *
 * Scoping multi-tenant strict : la facture ET le garage sont chargés par
 * `garageId` de session. Le mode démo/transmission vers un fournisseur (sandbox
 * ou PDP) se fait via la couche `@/lib/einvoicing` (voir docs).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { mapInvoiceToDocument, validateDocument, toUBL, toCII, type EInvoiceFormat } from '@/lib/einvoicing'

export const GET = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const url = new URL(req.url)
  const format: EInvoiceFormat = url.searchParams.get('format') === 'UBL' ? 'UBL' : 'CII'
  const download = url.searchParams.get('download') === '1'

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  const garage = await prisma.garage.findUnique({ where: { id: session.user.garageId } })
  if (!garage) return NextResponse.json({ error: 'Garage introuvable' }, { status: 404 })

  const document = mapInvoiceToDocument(
    {
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      taxRate: invoice.taxRate,
      notes: invoice.notes,
      clientName: invoice.clientName,
      clientAddress: invoice.clientAddress,
      clientEmail: invoice.clientEmail,
      clientPhone: invoice.clientPhone,
      lines: invoice.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
    },
    {
      name: garage.name,
      siret: garage.siret,
      vatNumber: garage.vatNumber,
      address: garage.address,
      email: garage.email,
      phone: garage.phone,
      iban: garage.iban,
      bic: garage.bic,
      currency: garage.currency,
      paymentTerms: garage.paymentTerms,
    },
  )

  const validation = validateDocument(document)
  const xml = format === 'UBL' ? toUBL(document) : toCII(document)

  if (download) {
    // Ne pas émettre silencieusement un XML non conforme en pièce jointe : si la
    // validation échoue, on refuse (422) avec les erreurs, sauf override explicite
    // ?force=1 (inspection). Le mode JSON (défaut) renvoie toujours la validation.
    if (!validation.valid && url.searchParams.get('force') !== '1') {
      return NextResponse.json(
        { error: 'Document non conforme — export refusé (ajoutez &force=1 pour inspecter).', validation },
        { status: 422 },
      )
    }
    const suffix = format === 'UBL' ? 'ubl' : 'facturx'
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoice.number}_${suffix}.xml"`,
      },
    })
  }

  return NextResponse.json({ document, validation, format, xml })
})

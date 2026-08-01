export const dynamic = 'force-dynamic'

/**
 * POST /api/invoices/[id]/einvoice/submit
 * Body (optionnel) : { format?: 'UBL'|'CII', idempotencyKey?: string }
 *
 * Mappe la facture → document EN 16931, VALIDE, et — si conforme — la dépose
 * auprès du fournisseur (sandbox) puis PERSISTE la transmission + un événement.
 * Idempotent par (garageId, idempotencyKey ; défaut = numéro:format). Refuse
 * (422) un document non conforme. Scoping tenant strict (garageId de session).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import {
  mapInvoiceToDocument, validateDocument, toUBL, toCII,
  SandboxEInvoiceProvider, type EInvoiceFormat,
} from '@/lib/einvoicing'
import { persistSubmission, listSubmissionsByInvoice } from '@/lib/einvoicing/store'

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* corps vide autorisé */ }
  const format: EInvoiceFormat = body.format === 'UBL' ? 'UBL' : 'CII'

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })
  const garage = await prisma.garage.findUnique({ where: { id: garageId } })
  if (!garage) return NextResponse.json({ error: 'Garage introuvable' }, { status: 404 })

  const document = mapInvoiceToDocument(
    {
      number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate,
      taxRate: invoice.taxRate, notes: invoice.notes, clientName: invoice.clientName,
      clientAddress: invoice.clientAddress, clientEmail: invoice.clientEmail, clientPhone: invoice.clientPhone,
      lines: invoice.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
    },
    {
      name: garage.name, siret: garage.siret, vatNumber: garage.vatNumber, address: garage.address,
      email: garage.email, phone: garage.phone, iban: garage.iban, bic: garage.bic,
      currency: garage.currency, paymentTerms: garage.paymentTerms,
    },
  )

  const validation = validateDocument(document)
  if (!validation.valid) {
    return NextResponse.json({ error: 'Document non conforme — dépôt refusé.', validation }, { status: 422 })
  }

  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : `${invoice.number}:${format}`

  const xml = format === 'UBL' ? toUBL(document) : toCII(document)
  const provider = new SandboxEInvoiceProvider()
  const result = await provider.submit(document, { format, idempotencyKey })

  const { submission, created } = await persistSubmission({
    invoiceId: invoice.id, garageId, provider: provider.name,
    externalSubmissionId: result.transmissionId, idempotencyKey, format, xml, status: result.status,
  })

  if (created) {
    await logAudit({ action: 'einvoice_submit', entityType: 'Invoice', entityId: invoice.id, session, req, details: { format, status: result.status, submissionId: submission.id } })
  }

  return NextResponse.json({ submission, validation, created }, { status: created ? 201 : 200 })
})

// GET liste des transmissions de la facture (raccourci pratique).
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const submissions = await listSubmissionsByInvoice(session.user.garageId, params.id)
  return NextResponse.json({ submissions })
})

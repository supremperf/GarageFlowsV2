export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { recordSignature } from '@/lib/signature-store'

// POST /api/work-orders/[id]/sign
// Body: { signatureData: base64 PNG, signerName?, fingerprint? }
export const POST = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.signatureData || typeof body.signatureData !== 'string') {
    return NextResponse.json({ error: 'signatureData requis (base64 PNG)' }, { status: 400 })
  }

  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wo = await prisma.workOrder.update({
    where: { id: params.id },
    data: {
      // Backward-compatible columns kept in sync with the audit record.
      signatureData: body.signatureData,
      signedAt: new Date(),
      status: 'signed',
    },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
    },
  })

  // Tamper-evident signature record: captures IP, browser, fingerprint + proof.
  const signature = await recordSignature({
    req,
    garageId: session.user.garageId,
    documentType: 'work_order',
    documentId: wo.id,
    documentNumber: wo.number,
    signerName: typeof body.signerName === 'string' && body.signerName.trim() ? body.signerName.trim() : wo.clientName,
    signerRole: 'client',
    action: 'sign',
    signatureData: body.signatureData,
    fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : null,
    content: {
      number: wo.number,
      clientName: wo.clientName,
      licensePlate: wo.licensePlate,
      vehicleModel: wo.vehicleModel,
      mileage: wo.mileage,
      worksJson: wo.worksJson,
      partsJson: wo.partsJson,
      totalHT: wo.totalHT,
      totalTTC: wo.totalTTC,
    },
  })

  return NextResponse.json({
    ...wo,
    signature: { id: signature.id, proofHash: signature.proofHash, signedAt: signature.signedAt },
  })
})

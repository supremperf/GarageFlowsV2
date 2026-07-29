export const dynamic = 'force-dynamic'

/**
 * GET /api/signatures?documentType=&documentId=   (Phase 3)
 *
 * Lists the electronic-signature audit records for the authenticated garage and
 * verifies each one's integrity proof on the fly (`integrityValid`). Optionally
 * filtered to a single document. The signature image itself is omitted from the
 * list payload (only its presence is reported) to keep the response light.
 */

import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { verifyStoredSignature } from '@/lib/signature-store'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const documentType = searchParams.get('documentType')?.trim() || undefined
  const documentId = searchParams.get('documentId')?.trim() || undefined

  const records = await prisma.signatureRecord.findMany({
    where: {
      garageId: session.user.garageId,
      ...(documentType ? { documentType } : {}),
      ...(documentId ? { documentId } : {}),
    },
    orderBy: { signedAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    count: records.length,
    signatures: records.map(r => ({
      id: r.id,
      documentType: r.documentType,
      documentId: r.documentId,
      documentNumber: r.documentNumber,
      signerName: r.signerName,
      signerRole: r.signerRole,
      action: r.action,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      fingerprint: r.fingerprint,
      contentHash: r.contentHash,
      proofHash: r.proofHash,
      signedAt: r.signedAt,
      hasSignatureImage: !!r.signatureData,
      // On-the-fly integrity check: false ⇒ the stored record was altered.
      integrityValid: verifyStoredSignature(r),
    })),
  })
})

/**
 * Persistence helper for electronic signatures (Phase 3).
 *
 * The single place that turns a signing request into a {@link SignatureRecord}:
 * it captures the request evidence (IP, browser), hashes the signed document
 * content and computes the integrity proof, then stores everything. Used by the
 * work-order signing route and the customer-portal quote signing route so the
 * evidence bundle is built identically everywhere.
 */

import { prisma } from '@/lib/db'
import type { SignatureRecord } from '@prisma/client'
import {
  computeContentHash,
  computeProofHash,
  verifyProofHash,
  extractRequestEvidence,
  stableStringify,
  type SignatureEvidence,
} from '@/lib/signature'

export type SignatureDocumentType = 'work_order' | 'quote' | 'restitution' | 'contract'
export type SignatureAction = 'sign' | 'accept' | 'refuse'

export interface RecordSignatureInput {
  req: Request
  garageId: string
  documentType: SignatureDocumentType
  documentId: string
  documentNumber?: string | null
  signerName: string
  signerRole?: 'client' | 'garage'
  action?: SignatureAction
  /** base64 PNG of the drawn signature ('' for a click-accept). */
  signatureData?: string
  fingerprint?: string | null
  /** The signed document content snapshot (any JSON-serialisable value). */
  content: unknown
}

/** Record a signature with full evidence + integrity proof. Returns the stored row. */
export async function recordSignature(input: RecordSignatureInput): Promise<SignatureRecord> {
  const { ipAddress, userAgent } = extractRequestEvidence(input.req)
  const signedAt = new Date()
  const contentHash = computeContentHash(stableStringify(input.content))

  const evidence: SignatureEvidence = {
    documentType: input.documentType,
    documentId: input.documentId,
    signerName: input.signerName,
    action: input.action ?? 'sign',
    signatureData: input.signatureData ?? '',
    contentHash,
    ipAddress,
    userAgent,
    fingerprint: input.fingerprint ?? null,
    signedAt: signedAt.toISOString(),
  }

  return prisma.signatureRecord.create({
    data: {
      garageId: input.garageId,
      documentType: input.documentType,
      documentId: input.documentId,
      documentNumber: input.documentNumber ?? null,
      signerName: input.signerName,
      signerRole: input.signerRole ?? 'client',
      action: input.action ?? 'sign',
      signatureData: input.signatureData ?? '',
      ipAddress,
      userAgent,
      fingerprint: input.fingerprint ?? null,
      contentHash,
      proofHash: computeProofHash(evidence),
      signedAt,
    },
  })
}

/** Re-derive the evidence bundle from a stored row and verify its integrity proof. */
export function verifyStoredSignature(rec: SignatureRecord): boolean {
  const evidence: SignatureEvidence = {
    documentType: rec.documentType,
    documentId: rec.documentId,
    signerName: rec.signerName,
    action: rec.action,
    signatureData: rec.signatureData,
    contentHash: rec.contentHash,
    ipAddress: rec.ipAddress,
    userAgent: rec.userAgent,
    fingerprint: rec.fingerprint,
    signedAt: rec.signedAt.toISOString(),
  }
  return verifyProofHash(evidence, rec.proofHash)
}

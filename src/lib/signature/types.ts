/**
 * Reinforced electronic signature — shared types.
 *
 * A signature seals a *canonical snapshot* of a document (the fields that must
 * not change after signing) together with the captured signature image and
 * evidentiary metadata (signer, timestamp, IP, user-agent). Integrity is proven
 * by a content hash (SHA-256 of the canonical document) plus an HMAC seal over
 * the hashes + metadata. Any later modification of the document changes its
 * content hash, so re-verification fails → the signature is auto-invalidated.
 */

export type SignableEntityType = 'quote' | 'invoice' | 'work_order' | 'contract' | 'handover'

export interface SignatureMeta {
  signerName: string
  signerRole?: string | null // 'client' | 'garage' | ...
  ipAddress?: string | null
  userAgent?: string | null
  /** ISO timestamp of signing (evidentiary). */
  signedAt: string
}

/** The tamper-evident certificate produced when signing. */
export interface SignatureCertificate {
  algorithm: string // e.g. 'SHA-256 / HMAC-SHA256'
  contentHash: string // SHA-256 of the canonical document snapshot
  imageHash: string // SHA-256 of the signature image bytes
  seal: string // HMAC over contentHash + imageHash + meta
  meta: SignatureMeta
  /** Canonical JSON of the document at signing time (for audit / re-verification). */
  documentSnapshot: string
}

export interface VerificationResult {
  valid: boolean
  /** Machine-readable reasons when invalid. */
  reasons: string[]
}

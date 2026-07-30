/**
 * Signature integrity core — hashing, sealing and verification.
 *
 * Pure functions: the HMAC key is always passed in, so they are fully
 * deterministic and testable. The API layer resolves the per-installation key
 * via resolveSignatureKey() (see key.ts).
 */
import crypto from 'crypto'
import { canonicalize } from './canonicalize'
import type {
  SignatureCertificate,
  SignatureMeta,
  VerificationResult,
} from './types'

export const SIGNATURE_ALGORITHM = 'SHA-256 / HMAC-SHA256'

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** SHA-256 of the canonical document snapshot. */
export function computeContentHash(document: unknown): string {
  return sha256Hex(canonicalize(document))
}

/** SHA-256 of the signature image (data URL or raw base64 accepted). */
export function computeImageHash(image: string): string {
  const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image
  // Hash the decoded bytes so re-encoding whitespace differences don't matter.
  let buf: Buffer
  try {
    buf = Buffer.from(base64, 'base64')
  } catch {
    buf = Buffer.from(image)
  }
  return sha256Hex(buf)
}

/** HMAC seal binding the content + image hashes to the evidentiary metadata. */
export function computeSeal(
  contentHash: string,
  imageHash: string,
  meta: SignatureMeta,
  key: string | Buffer,
): string {
  const payload = canonicalize({
    contentHash,
    imageHash,
    meta: {
      signerName: meta.signerName,
      signerRole: meta.signerRole ?? null,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      signedAt: meta.signedAt,
    },
  })
  return crypto.createHmac('sha256', key).update(payload).digest('hex')
}

/** Produce a tamper-evident certificate for a document + signature image. */
export function createCertificate(
  document: unknown,
  image: string,
  meta: SignatureMeta,
  key: string | Buffer,
): SignatureCertificate {
  const documentSnapshot = canonicalize(document)
  const contentHash = sha256Hex(documentSnapshot)
  const imageHash = computeImageHash(image)
  const seal = computeSeal(contentHash, imageHash, meta, key)
  return {
    algorithm: SIGNATURE_ALGORITHM,
    contentHash,
    imageHash,
    seal,
    meta,
    documentSnapshot,
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Verify a stored certificate against the CURRENT state of the document.
 *  - if the current document's content hash differs from the sealed one →
 *    the document was modified after signing (auto-invalidation).
 *  - if the seal doesn't recompute → the certificate record itself was tampered.
 */
export function verifyCertificate(
  currentDocument: unknown,
  certificate: Pick<SignatureCertificate, 'contentHash' | 'imageHash' | 'seal' | 'meta'>,
  key: string | Buffer,
): VerificationResult {
  const reasons: string[] = []

  const currentHash = computeContentHash(currentDocument)
  if (!timingSafeEqualHex(currentHash, certificate.contentHash)) {
    reasons.push('document_modified')
  }

  const expectedSeal = computeSeal(
    certificate.contentHash,
    certificate.imageHash,
    certificate.meta,
    key,
  )
  if (!timingSafeEqualHex(expectedSeal, certificate.seal)) {
    reasons.push('seal_tampered')
  }

  return { valid: reasons.length === 0, reasons }
}

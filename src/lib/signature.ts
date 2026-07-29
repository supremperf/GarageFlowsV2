/**
 * Phase 3 — Electronic signature integrity.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Produces the tamper-evident proof stored alongside every signature: a SHA-256
 * hash of the signed document content (`contentHash`) and a SHA-256 hash over the
 * whole evidence bundle (`proofHash`) — signature image, signer, action, content
 * hash, IP, browser and device fingerprint, and the exact signing instant.
 *
 * Any later modification of the stored record (or the underlying document)
 * changes the recomputed proof, so {@link verifyProofHash} detects tampering.
 * Pure Node crypto — deterministic and fully unit-testable.
 */

import crypto from 'crypto'

/**
 * Deterministic JSON serialisation (keys sorted at every level) so a document's
 * content hash is stable regardless of property order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep((value as Record<string, unknown>)[k])
        return acc
      }, {})
  }
  return value
}

/** SHA-256 hex of a document content snapshot (build the string via {@link stableStringify}). */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/** The evidence bundle that the integrity proof is computed over. */
export interface SignatureEvidence {
  documentType: string
  documentId: string
  signerName: string
  action: string
  /** base64 PNG of the drawn signature ('' for a click-accept). */
  signatureData: string
  /** Hash of the signed document content ({@link computeContentHash}). */
  contentHash: string
  ipAddress: string | null
  userAgent: string | null
  fingerprint: string | null
  /** ISO-8601 signing instant. */
  signedAt: string
}

/**
 * Deterministic SHA-256 integrity proof over the full evidence bundle.
 *
 * The evidence is serialised as a fixed-order JSON array so the canonical form is
 * unambiguous (each field is JSON-quoted, so no field value can bleed into the
 * next) and fully printable.
 */
export function computeProofHash(e: SignatureEvidence): string {
  const canonical = JSON.stringify([
    e.documentType,
    e.documentId,
    e.signerName,
    e.action,
    e.signatureData,
    e.contentHash,
    e.ipAddress ?? '',
    e.userAgent ?? '',
    e.fingerprint ?? '',
    e.signedAt,
  ])
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** Timing-safe verification of a stored proof hash against its evidence. */
export function verifyProofHash(e: SignatureEvidence, proofHash: string): boolean {
  const expected = computeProofHash(e)
  let a: Buffer
  let b: Buffer
  try {
    a = Buffer.from(expected, 'hex')
    b = Buffer.from(proofHash, 'hex')
  } catch {
    return false
  }
  if (a.length !== b.length || a.length === 0) return false
  return crypto.timingSafeEqual(a, b)
}

/** Extract request-derived evidence (client IP + browser) from a Request. */
export function extractRequestEvidence(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const h = req.headers
  const forwarded = h.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip')
  return { ipAddress: ip || null, userAgent: h.get('user-agent') }
}

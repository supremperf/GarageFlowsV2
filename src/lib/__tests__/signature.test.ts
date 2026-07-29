/**
 * Tests for the electronic-signature integrity logic (src/lib/signature.ts).
 * Verifies deterministic hashing, tamper detection and stable content hashing.
 */
import { describe, it, expect } from 'vitest'
import {
  stableStringify,
  computeContentHash,
  computeProofHash,
  verifyProofHash,
  type SignatureEvidence,
} from '../signature'

const evidence = (over: Partial<SignatureEvidence> = {}): SignatureEvidence => ({
  documentType: 'work_order',
  documentId: 'wo-1',
  signerName: 'Jean Dupont',
  action: 'sign',
  signatureData: 'data:image/png;base64,AAAA',
  contentHash: computeContentHash('the document'),
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (Test)',
  fingerprint: 'fp-abc',
  signedAt: '2026-07-27T10:00:00.000Z',
  ...over,
})

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })
  it('sorts keys deeply (nested objects and arrays)', () => {
    expect(stableStringify({ x: { c: 3, a: 1 }, list: [{ z: 1, a: 2 }] }))
      .toBe(stableStringify({ list: [{ a: 2, z: 1 }], x: { a: 1, c: 3 } }))
  })
})

describe('computeContentHash', () => {
  it('is deterministic and 64 hex chars (SHA-256)', () => {
    const h = computeContentHash('hello')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentHash('hello')).toBe(h)
  })
  it('changes when content changes', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'))
  })
})

describe('computeProofHash / verifyProofHash', () => {
  it('verifies an untampered evidence bundle', () => {
    const e = evidence()
    const proof = computeProofHash(e)
    expect(verifyProofHash(e, proof)).toBe(true)
  })

  it('detects tampering of any evidence field', () => {
    const e = evidence()
    const proof = computeProofHash(e)
    const fields: Partial<SignatureEvidence>[] = [
      { signerName: 'Someone Else' },
      { signatureData: 'data:image/png;base64,BBBB' },
      { ipAddress: '198.51.100.9' },
      { userAgent: 'Other/1.0' },
      { fingerprint: 'fp-xyz' },
      { signedAt: '2026-07-27T11:00:00.000Z' },
      { contentHash: computeContentHash('a different document') },
      { action: 'accept' },
      { documentId: 'wo-2' },
    ]
    for (const patch of fields) {
      expect(verifyProofHash(evidence(patch), proof)).toBe(false)
    }
  })

  it('rejects a malformed / empty proof hash', () => {
    const e = evidence()
    expect(verifyProofHash(e, '')).toBe(false)
    expect(verifyProofHash(e, 'zzzz')).toBe(false)
    expect(verifyProofHash(e, computeProofHash(e).slice(0, 10))).toBe(false)
  })

  it('treats null evidence fields distinctly from empty strings via the bundle', () => {
    const withNulls = evidence({ ipAddress: null, userAgent: null, fingerprint: null })
    const proof = computeProofHash(withNulls)
    expect(verifyProofHash(withNulls, proof)).toBe(true)
    // A populated fingerprint must not verify against the null-fingerprint proof.
    expect(verifyProofHash(evidence({ ipAddress: null, userAgent: null, fingerprint: 'x' }), proof)).toBe(false)
  })
})

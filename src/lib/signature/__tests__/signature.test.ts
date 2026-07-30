import { describe, it, expect } from 'vitest'
import {
  canonicalize,
  computeContentHash,
  computeImageHash,
  createCertificate,
  verifyCertificate,
  buildSignableDocument,
  isSupportedEntityType,
  type SignatureMeta,
} from '../index'

const KEY = Buffer.from('test-signature-key-1234567890')
const META: SignatureMeta = {
  signerName: 'Jean Dupont',
  signerRole: 'client',
  ipAddress: '192.0.2.10',
  userAgent: 'GarageFlow/1.0',
  signedAt: '2026-07-29T10:00:00.000Z',
}
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('canonicalize', () => {
  it('is independent of object key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }))
  })
  it('normalizes nested structures and dates', () => {
    const d = new Date('2026-01-02T03:04:05.000Z')
    expect(canonicalize({ x: [{ z: 1, a: 2 }], d })).toBe(
      '{"d":"2026-01-02T03:04:05.000Z","x":[{"a":2,"z":1}]}',
    )
  })
})

describe('computeImageHash', () => {
  it('hashes the decoded bytes (data URL == raw base64)', () => {
    const raw = IMAGE.slice(IMAGE.indexOf(',') + 1)
    expect(computeImageHash(IMAGE)).toBe(computeImageHash(raw))
  })
})

describe('certificate roundtrip', () => {
  const doc = { number: 'FAC-2026-001', total: 120.5, lines: [{ d: 'x', q: 1 }] }

  it('verifies a freshly created certificate', () => {
    const cert = createCertificate(doc, IMAGE, META, KEY)
    expect(cert.contentHash).toHaveLength(64)
    expect(cert.seal).toHaveLength(64)
    const res = verifyCertificate(doc, cert, KEY)
    expect(res.valid).toBe(true)
    expect(res.reasons).toHaveLength(0)
  })

  it('auto-invalidates when the document changes after signing', () => {
    const cert = createCertificate(doc, IMAGE, META, KEY)
    const modified = { ...doc, total: 130.0 } // amount changed post-signature
    const res = verifyCertificate(modified, cert, KEY)
    expect(res.valid).toBe(false)
    expect(res.reasons).toContain('document_modified')
  })

  it('detects a tampered seal', () => {
    const cert = createCertificate(doc, IMAGE, META, KEY)
    const tampered = { ...cert, seal: cert.seal.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }
    const res = verifyCertificate(doc, tampered, KEY)
    expect(res.valid).toBe(false)
    expect(res.reasons).toContain('seal_tampered')
  })

  it('fails verification under a different key', () => {
    const cert = createCertificate(doc, IMAGE, META, KEY)
    const res = verifyCertificate(doc, cert, Buffer.from('another-key'))
    expect(res.valid).toBe(false)
    expect(res.reasons).toContain('seal_tampered')
  })

  it('is stable across key order in the document', () => {
    const cert = createCertificate({ a: 1, b: 2 }, IMAGE, META, KEY)
    const res = verifyCertificate({ b: 2, a: 1 }, cert, KEY)
    expect(res.valid).toBe(true)
  })
})

describe('buildSignableDocument', () => {
  it('whitelists meaningful fields; ignores non-whitelisted changes', () => {
    const base = {
      number: 'DEV-2026-1', clientName: 'A', taxRate: 20, issueDate: '2026-01-01',
      lines: [{ description: 'x', quantity: 1, unitPrice: 10, sortOrder: 0 }],
      updatedAt: new Date(), status: 'sent',
    }
    const d1 = buildSignableDocument('quote', base)
    const d2 = buildSignableDocument('quote', { ...base, updatedAt: new Date('2030-01-01'), status: 'accepted' })
    expect(computeContentHash(d1)).toBe(computeContentHash(d2)) // non-whitelisted change → same hash
  })

  it('changes the hash when a whitelisted field changes', () => {
    const base = { number: 'DEV-2026-1', clientName: 'A', taxRate: 20, issueDate: '2026-01-01', lines: [] }
    const d1 = buildSignableDocument('quote', base)
    const d2 = buildSignableDocument('quote', { ...base, taxRate: 10 })
    expect(computeContentHash(d1)).not.toBe(computeContentHash(d2))
  })

  it('recognizes supported types', () => {
    expect(isSupportedEntityType('invoice')).toBe(true)
    expect(isSupportedEntityType('nope')).toBe(false)
  })
})

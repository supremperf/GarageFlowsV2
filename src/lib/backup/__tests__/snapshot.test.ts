/**
 * Tests the backup data pipeline end-to-end at the data level (no DB): a garage
 * snapshot survives JSON serialisation + AES-256-GCM encryption + decryption
 * intact, and countTables reports the right shape.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { encrypt, decrypt, sha256 } from '../crypto'
import { countTables, type GarageSnapshot } from '../snapshot'

const KEY = crypto.randomBytes(32)

function sampleSnapshot(): GarageSnapshot {
  return {
    version: 1,
    garageId: 'g1',
    createdAt: '2026-07-27T10:00:00.000Z',
    tables: {
      clients: [{ id: 'c1', name: 'Alice', garageId: 'g1', createdAt: '2026-01-01T00:00:00.000Z' }],
      vehicles: [{ id: 'v1', licensePlate: 'AA-1', clientId: 'c1', garageId: 'g1' }],
      jobs: [{ id: 'j1', status: 'in_progress', garageId: 'g1', estimatedDuration: 60 }],
      invoices: [{ id: 'i1', number: 'FAC-1', status: 'paid', garageId: 'g1', taxRate: 20 }],
      invoiceLines: [{ id: 'il1', invoiceId: 'i1', quantity: 1, unitPrice: 100, unitCost: 40, isLabor: false }],
    },
  }
}

describe('countTables', () => {
  it('counts rows per configured table (0 for absent tables)', () => {
    const counts = countTables(sampleSnapshot())
    expect(counts.clients).toBe(1)
    expect(counts.invoiceLines).toBe(1)
    expect(counts.warranties).toBe(0) // present in the spec, absent from this snapshot
  })
})

describe('backup pipeline (serialise → encrypt → decrypt → restore data)', () => {
  it('round-trips a snapshot byte-for-byte through encryption', () => {
    const snapshot = sampleSnapshot()
    const plaintext = JSON.stringify(snapshot)
    const checksum = sha256(plaintext)

    const env = encrypt(plaintext, KEY)
    const restored = decrypt(env, KEY).toString('utf8')

    expect(sha256(restored)).toBe(checksum)
    expect(JSON.parse(restored)).toEqual(snapshot)
  })

  it('a corrupted blob fails integrity (never restores silently)', () => {
    const env = encrypt(JSON.stringify(sampleSnapshot()), KEY)
    const ct = Buffer.from(env.ct, 'base64')
    ct[5] ^= 0x01
    expect(() => decrypt({ ...env, ct: ct.toString('base64') }, KEY)).toThrow()
  })
})

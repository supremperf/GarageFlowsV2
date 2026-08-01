import { describe, it, expect } from 'vitest'
import { mapInvoiceToDocument, type InvoiceInput, type GarageInput } from '../map'
import { SandboxEInvoiceProvider } from '../providers/sandbox'
import { canTransition } from '../provider'
import { signWebhook, verifyWebhook } from '../webhook'

const garage: GarageInput = { name: 'Garage Demo', siret: '73282932000074', vatNumber: 'FR40303265045', currency: 'EUR' }
const invoice: InvoiceInput = {
  number: 'FAC-2026-003', issueDate: '2026-04-01', taxRate: 20, clientName: 'Client',
  lines: [{ description: 'Diag', quantity: 1, unitPrice: 60 }],
}

function fixedProvider() {
  let t = 1_700_000_000_000
  return new SandboxEInvoiceProvider({ now: () => (t += 1000), newId: (() => { let n = 0; return () => `sbx-${++n}` })() })
}

describe('SandboxEInvoiceProvider — dépôt & cycle de vie', () => {
  it('dépose un document valide → SUBMITTED + XML', async () => {
    const p = fixedProvider()
    const doc = mapInvoiceToDocument(invoice, garage)
    const r = await p.submit(doc, { format: 'CII' })
    expect(r.ok).toBe(true)
    expect(r.status).toBe('SUBMITTED')
    expect(r.transmissionId).toBe('sbx-1')
    expect(r.xml).toContain('<rsm:CrossIndustryInvoice')
    expect(r.validation.valid).toBe(true)
  })

  it('refuse (REJECTED) un document invalide', async () => {
    const p = fixedProvider()
    const doc = mapInvoiceToDocument(invoice, { ...garage, siret: null, vatNumber: null })
    const r = await p.submit(doc)
    expect(r.ok).toBe(false)
    expect(r.status).toBe('REJECTED')
    expect(r.validation.errors.some((e) => e.code === 'GF-SELLER-ID')).toBe(true)
  })

  it('est idempotent (même clé → même transmission)', async () => {
    const p = fixedProvider()
    const doc = mapInvoiceToDocument(invoice, garage)
    const a = await p.submit(doc, { idempotencyKey: 'k1' })
    const b = await p.submit(doc, { idempotencyKey: 'k1' })
    expect(b.transmissionId).toBe(a.transmissionId)
  })

  it('rejeu idempotent : renvoie la validation du PREMIER dépôt (cohérence)', async () => {
    const p = fixedProvider()
    const validDoc = mapInvoiceToDocument(invoice, garage)
    const first = await p.submit(validDoc, { idempotencyKey: 'k2' })
    expect(first.ok).toBe(true)
    expect(first.validation.valid).toBe(true)
    // 2ᵉ appel, même clé, avec un doc INVALIDE : on doit récupérer la transmission
    // ET la validation d'origine (valides), pas la validation du doc invalide.
    const invalidDoc = mapInvoiceToDocument(invoice, { ...garage, siret: null, vatNumber: null })
    const replay = await p.submit(invalidDoc, { idempotencyKey: 'k2' })
    expect(replay.transmissionId).toBe(first.transmissionId)
    expect(replay.status).toBe('SUBMITTED')
    expect(replay.ok).toBe(true)
    expect(replay.validation.valid).toBe(true) // cohérent avec la transmission stockée
  })

  it('fait avancer le cycle SUBMITTED→RECEIVED→ACCEPTED→PAID', async () => {
    const p = fixedProvider()
    const doc = mapInvoiceToDocument(invoice, garage)
    const { transmissionId } = await p.submit(doc)
    await p.advance(transmissionId, 'RECEIVED')
    await p.advance(transmissionId, 'ACCEPTED')
    const s = await p.advance(transmissionId, 'PAID')
    expect(s?.status).toBe('PAID')
    expect(s?.history.map((h) => h.status)).toEqual(['SUBMITTED', 'RECEIVED', 'ACCEPTED', 'PAID'])
  })

  it('refuse une transition invalide', async () => {
    const p = fixedProvider()
    const doc = mapInvoiceToDocument(invoice, garage)
    const { transmissionId } = await p.submit(doc)
    await expect(p.advance(transmissionId, 'PAID')).rejects.toThrow(/Transition invalide/)
  })

  it('getStatus renvoie null pour un id inconnu', async () => {
    const p = fixedProvider()
    expect(await p.getStatus('inexistant')).toBeNull()
  })
})

describe('canTransition — machine à états', () => {
  it('autorise les transitions du flux et refuse les sauts', () => {
    expect(canTransition('SUBMITTED', 'RECEIVED')).toBe(true)
    expect(canTransition('ACCEPTED', 'PAID')).toBe(true)
    expect(canTransition('SUBMITTED', 'PAID')).toBe(false)
    expect(canTransition('PAID', 'DRAFT')).toBe(false)
  })
})

describe('verifyWebhook — signature & anti-rejeu', () => {
  const secret = 'whsec_'.padEnd(40, 'x')
  const now = 1_700_000_000_000
  const event = { id: 'evt-1', transmissionId: 'sbx-1', status: 'ACCEPTED' as const, timestamp: Math.floor(now / 1000) }
  const body = JSON.stringify(event)

  it('accepte une signature valide et fraîche', () => {
    const sig = signWebhook(body, secret)
    const r = verifyWebhook(body, sig, secret, { now: () => now })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.event.status).toBe('ACCEPTED')
  })
  it('refuse une signature invalide', () => {
    const r = verifyWebhook(body, 'sha256=deadbeef', secret, { now: () => now })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_invalide')
  })
  it('refuse un horodatage périmé (anti-rejeu)', () => {
    const sig = signWebhook(body, secret)
    const r = verifyWebhook(body, sig, secret, { now: () => now + 10 * 60 * 1000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('horodatage_hors_tolerance')
  })
  it('fail-closed sans secret', () => {
    const r = verifyWebhook(body, 'x', undefined, { now: () => now })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('secret_absent')
  })
})

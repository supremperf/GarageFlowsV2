import { describe, it, expect } from 'vitest'
import { classify, prepareAction, handleQuery } from '../index'

describe('classify — read intents', () => {
  it('routes pending-quote questions', () => {
    const c = classify('Quels devis attendent une réponse ?')
    expect(c.intent).toBe('pending_quotes')
    expect(c.kind).toBe('read')
    expect(c.confidence).toBe('high')
  })
  it('routes margin questions', () => {
    expect(classify("Quelle est la marge réalisée aujourd'hui ?").intent).toBe('margin')
  })
  it('routes proactive questions', () => {
    expect(classify('Quelles sont mes priorités ?').intent).toBe('proactive')
  })
  it('extracts a VIN and routes to vin_decode', () => {
    const c = classify('Décode le VIN 1HGCM82633A004352')
    expect(c.intent).toBe('vin_decode')
    expect(c.slots.vin).toBe('1HGCM82633A004352')
  })
  it('extracts an OBD code and routes to diagnostic', () => {
    const c = classify('Voyant moteur allumé, code P0300')
    expect(c.intent).toBe('diagnostic')
    expect(c.slots.obdCode).toBe('P0300')
  })
})

describe('classify — action intents', () => {
  it('recognizes create_quote as an action (not a read)', () => {
    const c = classify('Crée un devis pour ce client')
    expect(c.intent).toBe('create_quote')
    expect(c.kind).toBe('action')
  })
  it('recognizes send_reminder', () => {
    expect(classify('Relancer le client').intent).toBe('send_reminder')
  })
  it('returns unknown for gibberish', () => {
    expect(classify('blablabla xyz 123').kind).toBe('unknown')
  })
})

describe('prepareAction — confirmation gating', () => {
  it('always requires confirmation and never executes', () => {
    const a = prepareAction('create_quote', {})!
    expect(a.confirmationRequired).toBe(true)
    expect(a.endpoint).toBe('/api/quotes')
    expect(a.method).toBe('POST')
  })

  it('opens supplier-order tracking read-only instead of pointing at an empty POST', () => {
    const a = prepareAction('order_parts', {})!
    expect(a.confirmationRequired).toBe(true)
    expect(a.summary).toMatch(/suivi des commandes fournisseurs/i)
    expect(a.endpoint).toBe('/api/purchase-orders')
    expect(a.method).toBe('GET')
    expect(a.params).toEqual({})
  })
})

describe('handleQuery', () => {
  it('answers read intents with a resolver directive', () => {
    const r = handleQuery('Quels devis attendent une réponse ?')
    expect(r.type).toBe('answer')
    expect(r.resolver).toBe('quotes_pending')
  })
  it('returns a confirmation-gated proposal for action intents', () => {
    const r = handleQuery('Crée un devis')
    expect(r.type).toBe('action_proposal')
    expect(r.action?.confirmationRequired).toBe(true)
    expect(r.message).toMatch(/confirmation/i)
  })
  it('asks for clarification on unknown input', () => {
    const r = handleQuery('zzz')
    expect(r.type).toBe('unknown')
    expect(r.action).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { decodeObdCode, diagnose } from '../index'

describe('decodeObdCode', () => {
  it('decodes a generic powertrain misfire code', () => {
    const d = decodeObdCode('P0300')
    expect(d.valid).toBe(true)
    expect(d.system).toBe('powertrain')
    expect(d.scope).toBe('generic')
    expect(d.subsystem).toMatch(/Allumage/)
    expect(d.description).toMatch(/[Rr]atés/)
  })
  it('flags a manufacturer-specific code', () => {
    expect(decodeObdCode('P1301').scope).toBe('manufacturer')
  })
  it('rejects an invalid code', () => {
    expect(decodeObdCode('XYZ').valid).toBe(false)
  })
})

describe('diagnose', () => {
  it('boosts a cause corroborated by both a symptom and a code', () => {
    const r = diagnose({ symptoms: ['voyant moteur'], obdCodes: ['P0300'] })
    const coil = r.causes.find((c) => c.id === 'ignition_coil')!
    expect(coil.probability).toBe(75) // 0.60 base + 0.15 corroboration
    expect(coil.confidence).toBe('high')
    expect(coil.justification.length).toBeGreaterThanOrEqual(2)
  })

  it('ranks causes by probability and returns a merged check order', () => {
    const r = diagnose({ obdCodes: ['P0300'] })
    for (let i = 1; i < r.causes.length; i++) {
      expect(r.causes[i - 1].probability).toBeGreaterThanOrEqual(r.causes[i].probability)
    }
    expect(r.recommendedCheckOrder.length).toBeGreaterThan(0)
  })

  it('boosts wear-related causes at high mileage', () => {
    const r = diagnose({ symptoms: ['bruit frein'], mileage: 200000 })
    const pads = r.causes.find((c) => c.id === 'brake_pads')!
    expect(pads.probability).toBe(80) // 0.70 + 0.10 mileage
    expect(pads.justification.join(' ')).toMatch(/kilométrage/)
  })

  it('boosts a cause seen previously on the vehicle', () => {
    const r = diagnose({ symptoms: ['bruit frein'], history: ['Plaquettes'] })
    const pads = r.causes.find((c) => c.id === 'brake_pads')!
    expect(pads.probability).toBe(80)
    expect(pads.justification.join(' ')).toMatch(/antécédent/)
  })

  it('maps a catalyst code to the catalytic converter', () => {
    const r = diagnose({ obdCodes: ['P0420'] })
    expect(r.causes.some((c) => c.id === 'catalytic_converter')).toBe(true)
    expect(r.causes.some((c) => c.id === 'o2_sensor')).toBe(true)
  })

  it('links white smoke to a head-gasket check', () => {
    const r = diagnose({ symptoms: ['fumée blanche'] })
    expect(r.causes.some((c) => c.id === 'head_gasket')).toBe(true)
  })

  it('notes invalid codes and empty input', () => {
    expect(diagnose({ obdCodes: ['ZZZ'] }).notes.join(' ')).toMatch(/invalide/)
    expect(diagnose({}).notes.join(' ')).toMatch(/Aucun symptôme/)
    expect(diagnose({}).causes).toHaveLength(0)
  })
})

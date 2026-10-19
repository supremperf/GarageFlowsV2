import { describe, it, expect } from 'vitest'
import { lineCents, fromCents } from '@/lib/money'
import { generateQuote, billedHours, type QuoteOperation, type QuoteSuggestionInput } from '../index'

const oilChange: QuoteOperation = {
  repairType: 'oil_change',
  label: 'Vidange',
  laborMinutes: 30,
  parts: [
    { name: 'Filtre à huile', reference: 'OIL-9', unitPrice: 8, unitCost: 4, quantity: 1 },
    { name: 'Huile 5W-30 (5L)', unitPrice: 40, unitCost: 28, quantity: 1 },
  ],
}

const brakes: QuoteOperation = {
  repairType: 'brake_pads',
  label: 'Plaquettes de frein',
  laborMinutes: 45,
  parts: [{ name: 'Plaquettes avant', reference: 'BRK-1', unitPrice: 38, unitCost: 20, quantity: 1 }],
}

describe('billedHours', () => {
  it('rounds minutes up to the quarter-hour step', () => {
    expect(billedHours(30, 0.25)).toBe(0.5)
    expect(billedHours(45, 0.25)).toBe(0.75)
    expect(billedHours(20, 0.25)).toBe(0.5) // 0.33h → up to 0.5
    expect(billedHours(240, 0.25)).toBe(4)
    expect(billedHours(0, 0.25)).toBe(0)
  })
})

describe('generateQuote', () => {
  it('builds labour + parts lines and correct HT/VAT/TTC totals', () => {
    const q = generateQuote([oilChange], [], { laborRatePerHour: 60, vatRate: 20 })
    // labour: 0.5h × 60 = 30 ; parts: 8 + 40 = 48 ; subtotal 78
    expect(q.totals.laborHT).toBe(30)
    expect(q.totals.partsHT).toBe(48)
    expect(q.totals.subtotalHT).toBe(78)
    expect(q.totals.vat).toBe(15.6)
    expect(q.totals.totalTTC).toBe(93.6)
    expect(q.lines.filter((l) => l.isLabor)).toHaveLength(1)
    expect(q.lines.filter((l) => !l.isLabor)).toHaveLength(2)
  })

  it('computes margin from parts cost (labour is pure margin)', () => {
    const q = generateQuote([oilChange], [], { laborRatePerHour: 60 })
    // cost = filter 4 + oil 28 = 32 ; subtotal 78 ; margin 46 ; 46/78 = 59.0%
    expect(q.totals.estimatedCostHT).toBe(32)
    expect(q.totals.marginHT).toBe(46)
    expect(q.totals.marginPct).toBe(59)
  })

  it('aggregates multiple operations', () => {
    const q = generateQuote([oilChange, brakes], [], { laborRatePerHour: 60 })
    // labour: 0.5 + 0.75 = 1.25h × 60 = 75 ; parts: 48 + 38 = 86 ; subtotal 161
    expect(q.totals.laborHT).toBe(75)
    expect(q.totals.partsHT).toBe(86)
    expect(q.totals.subtotalHT).toBe(161)
    expect(q.laborMinutes).toBe(75)
  })

  it('keeps suggestions separate and out of the totals', () => {
    const suggestions: QuoteSuggestionInput[] = [
      { name: 'Joint de bouchon de vidange', reference: 'JNT-1', unitPrice: 2.5, quantity: 1, reason: 'Recommandé à chaque vidange' },
      { name: 'Nettoyant frein', unitPrice: null, quantity: 1, reason: 'Consommable' },
    ]
    const q = generateQuote([oilChange], suggestions, { laborRatePerHour: 60 })
    expect(q.suggestions).toHaveLength(2)
    expect(q.suggestions[0].lineTotalHT).toBe(2.5)
    expect(q.suggestions[1].lineTotalHT).toBeNull()
    expect(q.totals.suggestionsHT).toBe(2.5)
    // totals unchanged by suggestions
    expect(q.totals.subtotalHT).toBe(78)
  })

  it('uses a float-safe rounding for awkward amounts', () => {
    const op: QuoteOperation = { repairType: 'x', label: 'X', laborMinutes: 0, parts: [{ name: 'P', unitPrice: 10.1, quantity: 3 }] }
    const q = generateQuote([op], [], { laborRatePerHour: 60 })
    expect(q.totals.partsHT).toBe(30.3) // not 30.299999…
  })

  it('warns on an empty request, a missing rate and a missing part price', () => {
    const empty = generateQuote([], [], { laborRatePerHour: 60 })
    expect(empty.warnings.join(' ')).toMatch(/Aucune opération/)

    const noRate = generateQuote([oilChange], [], { laborRatePerHour: 0 })
    expect(noRate.warnings.some((w) => /Taux horaire/.test(w))).toBe(true)

    const noPrice = generateQuote(
      [{ repairType: 'x', label: 'X', laborMinutes: 10, parts: [{ name: 'Sans prix', unitPrice: 0, quantity: 1 }] }],
      [], { laborRatePerHour: 60 },
    )
    expect(noPrice.warnings.some((w) => /Prix manquant/.test(w))).toBe(true)
  })

  it('keeps every line self-consistent: quantity × unitPrice === lineTotalHT', () => {
    // Sub-cent supplier price: rounding the unit price once must reconcile.
    const op: QuoteOperation = { repairType: 'x', label: 'X', laborMinutes: 0, parts: [{ name: 'P', unitPrice: 10.005, quantity: 3 }] }
    const q = generateQuote([op], [], { laborRatePerHour: 60 })
    const line = q.lines[0]
    expect(fromCents(lineCents(line.unitPrice, line.quantity))).toBe(line.lineTotalHT)
  })

  it('never emits NaN or negative money from an invalid rate', () => {
    const nan = generateQuote([brakes], [], { laborRatePerHour: Number.NaN })
    expect(Number.isFinite(nan.totals.totalTTC)).toBe(true)
    expect(nan.totals.laborHT).toBe(0)
    expect(nan.warnings.some((w) => /Taux horaire/.test(w))).toBe(true)

    const neg = generateQuote([brakes], [], { laborRatePerHour: -90 })
    expect(neg.totals.subtotalHT).toBeGreaterThanOrEqual(0)
    expect(neg.totals.laborHT).toBe(0)
  })

  it('honours a custom VAT rate', () => {
    const q = generateQuote([brakes], [], { laborRatePerHour: 60, vatRate: 10 })
    // labour 0.75×60=45 ; parts 38 ; subtotal 83 ; vat 8.3 ; ttc 91.3
    expect(q.totals.subtotalHT).toBe(83)
    expect(q.totals.vat).toBe(8.3)
    expect(q.totals.totalTTC).toBe(91.3)
  })
})

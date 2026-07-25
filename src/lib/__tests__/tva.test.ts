/**
 * TVA / invoice calculation tests — imports real helpers from src/lib/billing.ts.
 */
import { describe, it, expect } from 'vitest'
import { calcTotalHT, calcTotalTTC, calcTaxAmount, roundCents, withTotals } from '../billing'

type Line = { quantity: number; unitPrice: number }

describe('calcTotalHT', () => {
  it('sums lines correctly', () => {
    const lines: Line[] = [{ quantity: 2, unitPrice: 50 }, { quantity: 1, unitPrice: 30 }]
    expect(calcTotalHT(lines)).toBe(130)
  })

  it('returns 0 for empty list', () => {
    expect(calcTotalHT([])).toBe(0)
  })
})

describe('calcTotalTTC', () => {
  it('applies 20% TVA', () => {
    expect(calcTotalTTC([{ quantity: 1, unitPrice: 100 }], 20)).toBe(120)
  })

  it('applies 10% TVA (floating-point safe after rounding)', () => {
    expect(roundCents(calcTotalTTC([{ quantity: 1, unitPrice: 100 }], 10))).toBe(110)
  })

  it('returns HT when rate is 0', () => {
    const lines: Line[] = [{ quantity: 3, unitPrice: 49.99 }]
    expect(calcTotalTTC(lines, 0)).toBe(calcTotalHT(lines))
  })
})

describe('calcTaxAmount', () => {
  it('computes TVA amount at 20%', () => {
    expect(calcTaxAmount([{ quantity: 1, unitPrice: 100 }], 20)).toBeCloseTo(20, 10)
  })
})

describe('roundCents', () => {
  it('rounds 1/3 of 100 to 33.33', () => {
    expect(roundCents(100 / 3)).toBe(33.33)
  })

  it('is a no-op on integers', () => {
    expect(roundCents(120)).toBe(120)
  })
})

describe('withTotals', () => {
  it('attaches rounded totalHT and totalTTC to a document', () => {
    const doc = {
      lines:   [{ quantity: 4, unitPrice: 25 }, { quantity: 2, unitPrice: 15.5 }, { quantity: 1, unitPrice: 5.99 }],
      taxRate: 20,
    }
    const result = withTotals(doc)
    expect(result.totalHT).toBe(136.99)
    expect(result.totalTTC).toBe(roundCents(136.99 * 1.2))
  })

  it('preserves all original fields', () => {
    const doc = { id: 'abc', lines: [{ quantity: 1, unitPrice: 50 }], taxRate: 20, status: 'draft' }
    const result = withTotals(doc)
    expect(result.id).toBe('abc')
    expect(result.status).toBe('draft')
  })
})

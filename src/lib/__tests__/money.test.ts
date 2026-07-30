import { describe, it, expect } from 'vitest'
import { toCents, fromCents, computeTotals, applyDiscountCents, balanceCents } from '@/lib/money'
import { calcTotalHT, calcTotalTTC, calcTaxAmount, withTotals } from '@/lib/billing'

describe('money — arithmétique exacte en centimes', () => {
  it('0,1 + 0,2 = 0,3 exactement (pas de bruit flottant)', () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], 0)
    expect(t.totalHT).toBe(0.3)
    expect(t.totalHTCents).toBe(30)
  })

  it('toCents/fromCents arrondit correctement (1,005 → 100 ou 101 sans dérive)', () => {
    expect(toCents(1.005)).toBe(101) // demi vers le haut, robuste au bruit
    expect(fromCents(101)).toBe(1.01)
    expect(toCents(19.99)).toBe(1999)
    expect(fromCents(toCents(0.1 + 0.2))).toBe(0.3)
  })

  it('INVARIANT : totalTTC = totalHT + TVA (toujours, en centimes)', () => {
    const cases = [
      { lines: [{ quantity: 3, unitPrice: 33.33 }], rate: 20 },
      { lines: [{ quantity: 1, unitPrice: 0.1 }, { quantity: 2, unitPrice: 0.15 }], rate: 5.5 },
      { lines: [{ quantity: 7, unitPrice: 12.34 }, { quantity: 1, unitPrice: 999.99 }], rate: 20 },
      { lines: [{ quantity: 1.5, unitPrice: 60 }], rate: 10 },
    ]
    for (const c of cases) {
      const t = computeTotals(c.lines, c.rate)
      expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
      expect(t.totalTTC).toBe(fromCents(t.totalHTCents + t.taxCents))
    }
  })

  it('arrondi de TVA à 20 % sur un HT non rond', () => {
    // HT = 100,00 ; TVA 20 % = 20,00 ; TTC = 120,00
    const t = computeTotals([{ quantity: 1, unitPrice: 100 }], 20)
    expect(t.taxAmount).toBe(20)
    expect(t.totalTTC).toBe(120)
  })

  it('quantité décimale (heures de main-d’œuvre)', () => {
    const t = computeTotals([{ quantity: 2.5, unitPrice: 60 }], 20)
    expect(t.totalHT).toBe(150)
    expect(t.totalTTC).toBe(180)
  })

  it('plusieurs lignes de facture', () => {
    const t = computeTotals(
      [{ quantity: 2, unitPrice: 19.99 }, { quantity: 1, unitPrice: 5.5 }, { quantity: 3, unitPrice: 0.33 }],
      20,
    )
    // HT = 39,98 + 5,50 + 0,99 = 46,47
    expect(t.totalHT).toBe(46.47)
    expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
  })

  it('remise en pourcentage puis fixe', () => {
    // 100 € - 10% = 90 € ; - 5 € fixe = 85 €
    expect(applyDiscountCents(toCents(100), { percent: 10, fixedEuros: 5 })).toBe(toCents(85))
  })

  it('remise ne descend jamais sous zéro', () => {
    expect(applyDiscountCents(toCents(10), { fixedEuros: 50 })).toBe(0)
  })

  it('solde = TTC − paiements − avoirs (exact)', () => {
    const ttc = toCents(120) // 120 €
    // acompte 50 + paiement partiel 30 ; avoir 10 → solde 30
    expect(balanceCents(ttc, [50, 30], [10])).toBe(toCents(30))
  })

  it('grands montants sans perte de précision', () => {
    const t = computeTotals([{ quantity: 1000000, unitPrice: 1234.56 }], 20)
    expect(t.totalHTCents).toBe(123456000000)
    expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
  })
})

describe('billing — délègue à la couche centimes (compat API)', () => {
  const lines = [{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }]
  it('calcTotalHT/TTC/Tax exacts', () => {
    expect(calcTotalHT(lines)).toBe(0.3)
    expect(calcTotalTTC(lines, 20)).toBe(0.36)
    expect(calcTaxAmount(lines, 20)).toBe(0.06)
  })
  it('withTotals attache des totaux exacts', () => {
    const doc = withTotals({ lines, taxRate: 20 })
    expect(doc.totalHT).toBe(0.3)
    expect(doc.totalTTC).toBe(0.36)
  })
})

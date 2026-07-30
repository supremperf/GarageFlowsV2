/**
 * Cohérence des totaux entre le rendu document (PDF/UI) et l'API/DB.
 *
 * Les composants InvoiceModal/QuoteInvoiceModal calculent désormais leurs
 * totaux via lib/money (computeTotals), exactement comme la couche billing
 * utilisée par l'API. Ce test verrouille l'invariant : peu importe le chemin,
 * HT/TVA/TTC sont identiques et exacts (aucune dérive flottante).
 */
import { describe, it, expect } from 'vitest'
import { computeTotals, multiplyCents, toCents, fromCents } from '../money'
import { withTotals } from '../billing'

describe('Cohérence totaux document (PDF/UI) ↔ API/DB', () => {
  it('main-d’œuvre + pièces : rendu PDF == total API sur des valeurs piégeuses', () => {
    // Cas piégeux : heures décimales et prix à décimales fines.
    const hourlyRate = 62.5
    const laborHours = 1.75           // 1h45
    const taxRate    = 20

    const parts = [
      { quantity: 3, unitPrice: 12.9 },
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 2, unitPrice: 0.2 },
    ]

    // Chemin « document » (comme InvoiceModal) : ligne main-d’œuvre + lignes pièces.
    const laborLine = { quantity: laborHours, unitPrice: hourlyRate }
    const docTotals = computeTotals([laborLine, ...parts], taxRate)

    // Chemin « API/DB » : les mêmes lignes stockées, totaux via withTotals.
    const apiDoc = withTotals({ lines: [laborLine, ...parts], taxRate })

    expect(docTotals.totalHT).toBe(apiDoc.totalHT)
    expect(docTotals.totalTTC).toBe(apiDoc.totalTTC)
    // Invariant comptable exact.
    expect(docTotals.totalTTCCents).toBe(docTotals.totalHTCents + docTotals.taxCents)
  })

  it('la somme des sous-totaux (MO + pièces) égale le total HT (aucune dérive)', () => {
    const hourlyRate = 60
    const laborHours = 2.5
    const parts = [
      { quantity: 4, unitPrice: 9.99 },
      { quantity: 7, unitPrice: 3.33 },
    ]
    const laborHTCents = multiplyCents(toCents(hourlyRate), laborHours)
    const partsHTCents = parts.reduce((c, p) => c + multiplyCents(toCents(p.unitPrice), p.quantity), 0)

    const totals = computeTotals([{ quantity: laborHours, unitPrice: hourlyRate }, ...parts], 20)
    expect(fromCents(laborHTCents + partsHTCents)).toBe(totals.totalHT)
  })

  it('0,1 € + 0,2 € affiché = 0,30 € (jamais 0,30000000004)', () => {
    const totals = computeTotals([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], 0)
    expect(totals.totalHT).toBe(0.3)
    expect(totals.totalHT.toFixed(2)).toBe('0.30')
  })
})

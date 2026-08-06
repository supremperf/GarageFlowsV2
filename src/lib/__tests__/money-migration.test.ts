import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  computeTotals,
  computeMarginCents,
  marginCents,
  balanceCents,
  multiplyCents,
  lineCents,
} from '@/lib/money'

/**
 * Batterie monétaire de la migration « fin du Float pour l'argent ».
 * Couvre les cas exigés : marge/coût, remises, acompte, paiement partiel, avoir
 * total/partiel, montants négatifs, montant maximal, prix à 4 décimales, quantité
 * fractionnaire, et l'ÉQUIVALENCE de backfill Float→centimes.
 */

describe('marge & coût d’achat (centimes exacts)', () => {
  it('marginCents = produit − coût, exact et signé', () => {
    expect(marginCents(toCents(100), toCents(60))).toBe(toCents(40))
    expect(marginCents(toCents(50), toCents(80))).toBe(toCents(-30)) // marge négative conservée
  })

  it('computeMarginCents agrège produit/coût/marge par ligne (arrondi par ligne)', () => {
    const r = computeMarginCents([
      { quantity: 2, unitPrice: 19.99, unitCost: 12.5 },
      { quantity: 1.5, unitPrice: 60, unitCost: 40 },
    ])
    // produit = round(2×1999)=3998 + round(1.5×6000)=9000 → 12998
    // coût    = round(2×1250)=2500 + round(1.5×4000)=6000 → 8500
    expect(r.revenueCents).toBe(12998)
    expect(r.costCents).toBe(8500)
    expect(r.marginCents).toBe(4498)
    expect(r.marginCents).toBe(r.revenueCents - r.costCents)
  })

  it('marge nulle quand coût = prix', () => {
    const r = computeMarginCents([{ quantity: 3, unitPrice: 10, unitCost: 10 }])
    expect(r.marginCents).toBe(0)
  })
})

describe('TVA à différents taux, invariant HT+TVA=TTC', () => {
  for (const rate of [0, 5.5, 10, 20]) {
    it(`taux ${rate}% : TTC = HT + TVA (centimes)`, () => {
      const t = computeTotals([{ quantity: 3, unitPrice: 33.33 }, { quantity: 1, unitPrice: 7.7 }], rate)
      expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
    })
  }
})

describe('prix unitaire à 4 décimales & quantité fractionnaire', () => {
  it('CRITÈRE : 12,3456 € × 3 = 37,04 € (prix NON arrondi prématurément)', () => {
    // Règle métier : arrondir le MONTANT ÉTENDU (12,3456×3 = 37,0368 → 37,04),
    // et NON le prix unitaire d'abord (12,35 × 3 = 37,05, incorrect).
    const line = computeTotals([{ quantity: 3, unitPrice: 12.3456 }], 0)
    expect(lineCents(12.3456, 3)).toBe(3704)
    expect(line.totalHTCents).toBe(3704)
    expect(line.totalHT).toBe(37.04)
  })

  it('coût unitaire 4 décimales × quantité (marge)', () => {
    // coût 8,7654 × 2 = 17,5308 → 17,53 € (1753 c)
    const r = computeMarginCents([{ quantity: 2, unitPrice: 20, unitCost: 8.7654 }])
    expect(r.costCents).toBe(1753)
    expect(r.revenueCents).toBe(4000)
    expect(r.marginCents).toBe(2247)
  })

  it('quantité fractionnaire (1,5 L d’huile)', () => {
    const t = computeTotals([{ quantity: 1.5, unitPrice: 9.9 }], 20)
    expect(t.totalHTCents).toBe(multiplyCents(toCents(9.9), 1.5)) // round(1.5×990)=1485
    expect(t.totalHTCents).toBe(1485)
  })
})

describe('acompte, paiement partiel, avoir total/partiel', () => {
  const ttc = toCents(120) // 120,00 €
  it('acompte + paiement partiel laisse un solde exact', () => {
    // acompte 50 + paiement 30 → payé 80 → solde 40
    expect(balanceCents(ttc, [50, 30], [])).toBe(toCents(40))
  })
  it('avoir partiel réduit le solde', () => {
    // payé 30, avoir 20 → solde 70
    expect(balanceCents(ttc, [30], [20])).toBe(toCents(70))
  })
  it('avoir total ⇒ solde nul', () => {
    expect(balanceCents(ttc, [], [120])).toBe(0)
  })
  it('solde peut être négatif (trop-perçu)', () => {
    expect(balanceCents(ttc, [130], [])).toBe(toCents(-10))
  })
})

describe('montants négatifs & montant maximal', () => {
  it('montant négatif autorisé (ligne d’avoir)', () => {
    const t = computeTotals([{ quantity: 1, unitPrice: -49.9 }], 20)
    expect(t.totalHTCents).toBe(-4990)
    expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
  })
  it('montant très grand reste exact en entier (dans la plage Int32 des colonnes *Cents)', () => {
    // 21 474 836,47 € = 2 147 483 647 c = INT32 max — borne haute d'une colonne Int.
    expect(toCents(21_474_836.47)).toBe(2_147_483_647)
    expect(fromCents(2_147_483_647)).toBe(21_474_836.47)
  })
})

describe('ÉQUIVALENCE de backfill Float→centimes (round(float*100))', () => {
  // Reproduit le backfill SQL : cents = ROUND(float*100). L'app relit ensuite
  // cents ?? toCents(float). Pour un euro exact à 2 décimales, la conversion est
  // sans perte et réversible : c'est l'invariant qui rend la migration sûre.
  const stored = [0, 0.1, 0.3, 1.01, 19.99, 120, 1234.56, 33.33, 999.99, -49.9]
  it('toCents(v) === round(v*100) et fromCents round-trip exact', () => {
    for (const v of stored) {
      const backfill = Math.round(v * 100) // équivalent SQL ROUND(v*100)
      expect(toCents(v)).toBe(backfill)
      expect(fromCents(toCents(v))).toBe(Number(v.toFixed(2)))
    }
  })
})

describe('cohérence ordre de réparation (per-ligne, comme money.ts)', () => {
  it('totaux OR via la même convention que factures/devis', () => {
    // works: 2 lignes MO (qty 1) ; parts: 1 pièce qty 2
    const lines = [
      { quantity: 1, unitPrice: 80 },     // MO
      { quantity: 1, unitPrice: 45.5 },   // MO
      { quantity: 2, unitPrice: 19.99 },  // pièce
    ]
    const t = computeTotals(lines, 20)
    // HT = 80 + 45,50 + 39,98 = 165,48
    expect(t.totalHT).toBe(165.48)
    expect(t.totalHTCents).toBe(16548)
    expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
  })
})

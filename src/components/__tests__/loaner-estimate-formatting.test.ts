/**
 * GF31-AUD-028 — le total estimé d'un prêt s'affichait en flottant brut.
 *
 * L'estimation annoncée AU COMPTOIR était le produit JavaScript nu
 * `jours × Number(dailyRate)` : 3 × 19,90 € donnait « 59.699999999999996€ ».
 * Ni un montant lisible, ni un montant monétaire — au moment précis où l'on
 * annonce un prix à un client.
 *
 * Deux verrous : la valeur (calcul entier de la couche monétaire) et la source
 * (le motif fautif ne doit pas réapparaître dans le composant).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatEuros, fromCents, lineTotalCentsFromScaled, toScaled } from '@/lib/money'

/** Reproduit exactement la composition utilisée par LoanerPanel. */
const estimation = (tarifEuros: number, jours: number) =>
  formatEuros(fromCents(lineTotalCentsFromScaled(toScaled(tarifEuros), toScaled(jours))))

describe('GF31-AUD-028 — estimation de prêt', () => {
  it('3 jours × 19,90 € = 59.70 € (et non 59.699999999999996)', () => {
    expect(estimation(19.9, 3)).toBe('59.70 €')
  })

  it.each([
    [0.1, 3, '0.30 €'],
    [29.99, 7, '209.93 €'],
    [1.005, 1, '1.01 €'],   // arrondi demi-éloigné-de-zéro, pas le biais IEEE
    [100, 1, '100.00 €'],
  ])('%s €/jour × %s jours = %s', (tarif, jours, attendu) => {
    expect(estimation(tarif, jours)).toBe(attendu)
  })

  it('rend toujours deux décimales exactement', () => {
    for (const [t, j] of [[19.9, 3], [0.01, 1], [7.77, 9]] as const) {
      expect(estimation(t, j)).toMatch(/^\d+\.\d{2} €$/)
    }
  })

  it('le composant passe par la couche monétaire, pas par un produit flottant', () => {
    const src = readFileSync(path.resolve(__dirname, '../LoanerPanel.tsx'), 'utf8')
    expect(src).toContain('formatEuros(')
    expect(src).toContain('lineTotalCentsFromScaled(')
    // Le motif d'origine : `… * Number(resForm.dailyRate)}€`, rendu tel quel.
    expect(src).not.toMatch(/\*\s*Number\(resForm\.dailyRate\)\}€/)
  })
})

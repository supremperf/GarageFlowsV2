import { describe, it, expect } from 'vitest'
import { formatEuros, roundEurosForDisplay } from '../money'

/**
 * Non-régression du « -0.00 € » observé sur la carte rentabilité.
 * Le signe doit être décidé APRÈS l'arrondi au centime.
 */
describe('formatEuros — zéro jamais signé', () => {
  it('coût nul affiché en poste de coût', () => {
    expect(formatEuros(0, 'negative')).toBe('0.00 €')
  })

  it('coût qui s’arrondit à zéro', () => {
    expect(formatEuros(0.004, 'negative')).toBe('0.00 €')
    expect(formatEuros(-0.004, 'negative')).toBe('0.00 €')
  })

  it('zéro négatif IEEE-754', () => {
    expect(formatEuros(-0, 'negative')).toBe('0.00 €')
    expect(formatEuros(-0, 'always')).toBe('0.00 €')
    expect(formatEuros(-0, 'auto')).toBe('0.00 €')
  })

  it('marge nulle sans « + » ni « - »', () => {
    expect(formatEuros(0, 'always')).toBe('0.00 €')
    expect(formatEuros(-0.0049, 'always')).toBe('0.00 €')
  })

  it('aucune sortie ne contient « -0.00 » ni « +0.00 »', () => {
    const values = [0, -0, 0.001, -0.001, 0.004, -0.004, 0.0049, -0.0049, 1e-9, -1e-9]
    for (const v of values) {
      for (const sign of ['auto', 'always', 'negative'] as const) {
        const out = formatEuros(v, sign)
        expect(out, `formatEuros(${v}, '${sign}')`).toBe('0.00 €')
      }
    }
  })
})

describe('formatEuros — montants réels', () => {
  it('poste de coût', () => {
    expect(formatEuros(12.3, 'negative')).toBe('-12.30 €')
    expect(formatEuros(-12.3, 'negative')).toBe('-12.30 €')
  })

  it('signe forcé', () => {
    expect(formatEuros(12.3, 'always')).toBe('+12.30 €')
    expect(formatEuros(-12.3, 'always')).toBe('-12.30 €')
  })

  it('signe automatique', () => {
    expect(formatEuros(12.3)).toBe('12.30 €')
    expect(formatEuros(-12.3)).toBe('-12.30 €')
  })

  it('arrondi au centime', () => {
    expect(formatEuros(1.005, 'auto')).toBe('1.01 €')
    expect(formatEuros(1234.567, 'auto')).toBe('1234.57 €')
  })

  it('entrée non finie neutralisée', () => {
    expect(formatEuros(NaN, 'always')).toBe('0.00 €')
    expect(formatEuros(Infinity, 'negative')).toBe('0.00 €')
  })
})

describe('roundEurosForDisplay', () => {
  it('supprime le zéro signé', () => {
    expect(Object.is(roundEurosForDisplay(-0.004), -0)).toBe(false)
    expect(roundEurosForDisplay(-0.004)).toBe(0)
    // Le choix de couleur « >= 0 » doit donc classer un coût nul en positif.
    expect(roundEurosForDisplay(-0) >= 0).toBe(true)
  })
})

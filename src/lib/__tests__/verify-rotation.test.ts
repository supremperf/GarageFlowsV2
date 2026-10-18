/**
 * Preuve de rotation des secrets (scripts/verify-rotation.mjs) — lot secrets.
 *
 * Prouve la MÉCANIQUE de la preuve de rotation (sans jamais manipuler de vrai
 * secret) : le hash d'un secret ACTUEL correspondant à une empreinte compromise
 * est détecté ; une valeur rotée passe ; une variable absente est signalée
 * comme non vérifiable.
 */
import { describe, it, expect } from 'vitest'
import { checkRotation, sha256Hex } from '../../../scripts/verify-rotation.mjs'

// Valeur de test arbitraire ; on dérive son empreinte pour construire un
// manifeste « compromis » synthétique — aucun vrai secret n'est utilisé.
const COMPROMISED_VALUE = 'valeur-compromise-de-test-0123456789'
const PREFIX = (sha256Hex(COMPROMISED_VALUE) as string).slice(0, 8)

const manifest = [
  { env: 'TEST_SECRET_A', sha256Prefix: PREFIX, action: 'rotation A' },
  { env: 'TEST_SECRET_B', sha256Prefix: PREFIX, action: 'rotation B' },
]

describe('checkRotation — détection des secrets non rotés', () => {
  it('détecte un secret ACTUEL encore égal à la valeur compromise', () => {
    const r = checkRotation(manifest, { TEST_SECRET_A: COMPROMISED_VALUE, TEST_SECRET_B: 'une-valeur-rotee-distincte' })
    expect(r.compromised.map((c: { env: string }) => c.env)).toEqual(['TEST_SECRET_A'])
    expect(r.rotated.map((c: { env: string }) => c.env)).toEqual(['TEST_SECRET_B'])
    expect(r.unverified).toEqual([])
  })

  it('une valeur rotée (empreinte différente) passe', () => {
    const r = checkRotation(manifest, { TEST_SECRET_A: 'rotee-1', TEST_SECRET_B: 'rotee-2' })
    expect(r.compromised).toEqual([])
    expect(r.rotated).toHaveLength(2)
  })

  it('une variable absente est signalée non vérifiable (jamais « rotée » par défaut)', () => {
    const r = checkRotation(manifest, { TEST_SECRET_A: 'rotee-1' })
    expect(r.unverified.map((u: { env: string }) => u.env)).toEqual(['TEST_SECRET_B'])
  })

  it('chaîne vide = non vérifiable (pas un faux positif de rotation)', () => {
    const r = checkRotation(manifest, { TEST_SECRET_A: '', TEST_SECRET_B: '' })
    expect(r.unverified).toHaveLength(2)
    expect(r.rotated).toEqual([])
    expect(r.compromised).toEqual([])
  })

  it('l\'empreinte ne révèle pas la valeur (sha256, longueur 64 hex)', () => {
    const h = sha256Hex('quoi-que-ce-soit') as string
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('quoi')
  })
})

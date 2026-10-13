import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { hwidV1, normalizeHwidField, isHwidV1, HWID_V1_CANONICAL_KEYS } from '../hwid-v1'

const ROOT = process.cwd()
const vectors = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/hwid-v1-vectors.json'), 'utf8')).vectors as Array<{
  name: string; fields: Record<string, string>; expected: string
}>

function python3Available(): boolean {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

describe('HWID V1 — canonique, déterministe (AUD-036)', () => {
  it('produit exactement la sortie attendue pour chaque vecteur', () => {
    for (const v of vectors) expect(hwidV1(v.fields), v.name).toBe(v.expected)
  })

  it('forme HWID1-<64hex> valide', () => {
    for (const v of vectors) expect(isHwidV1(v.expected)).toBe(true)
    expect(isHwidV1('HWID1-xyz')).toBe(false)
    expect(isHwidV1('deadbeef')).toBe(false)
  })

  it('déterministe : même entrée → même sortie', () => {
    const f = { cpu: 'X', mac: 'y', platform: 'p' }
    expect(hwidV1(f)).toBe(hwidV1(f))
  })

  it('normalisation : casse + espaces + Unicode NFC tolérés', () => {
    expect(normalizeHwidField('  Intel   CORE ')).toBe('intel core')
    // Le vecteur « casing-and-space-noise » doit égaler « full-windows ».
    const full = vectors.find(v => v.name === 'full-windows')!
    const noisy = vectors.find(v => v.name === 'casing-and-space-noise')!
    expect(hwidV1(noisy.fields)).toBe(full.expected)
  })

  it('champ absent → traité comme vide (empreinte toujours définie)', () => {
    expect(hwidV1({ cpu: 'a' })).toBe(hwidV1({ cpu: 'a', mac: '', platform: '', diskSerial: '', machineId: '' }))
  })

  it('clés canoniques figées (tout réordonnancement changerait toutes les empreintes)', () => {
    expect([...HWID_V1_CANONICAL_KEYS]).toEqual(['cpu', 'diskSerial', 'mac', 'machineId', 'platform'])
  })
})

describe('HWID V1 — parité Node ↔ Python (référence scripts/hwid_v1.py)', () => {
  const hasPy = python3Available()
  /**
   * Délai EXPLICITE : ce test lance un interpréteur Python par vecteur. Le coût
   * n'est pas dans le calcul mais dans la création de processus (~100–300 ms
   * pièce sous Windows). Isolé il tient en ~0,7 s ; exécuté en parallèle du
   * reste de la suite il est monté à 5,6 s et dépassait le délai PAR DÉFAUT de
   * vitest (5 s) — la suite complète rapportait alors « parité Node ↔ Python
   * en échec », c'est-à-dire une divergence cryptographique inexistante, une
   * fois sur deux selon la charge de la machine.
   *
   * Un faux échec sur un test de parité crypto est pire qu'un test lent : il
   * discrédite la seule preuve que le générateur Python et le générateur Node
   * produisent la même empreinte. Le budget est donc borné franchement.
   */
  it.skipIf(!hasPy)('Python produit exactement les mêmes HWID que Node/attendu', () => {
    for (const v of vectors) {
      const out = execFileSync('python3', ['scripts/hwid_v1.py', '--stdin'], {
        cwd: ROOT, input: JSON.stringify(v.fields), encoding: 'utf8',
      }).trim()
      expect(out, `python(${v.name})`).toBe(v.expected)
      expect(out, `node==python(${v.name})`).toBe(hwidV1(v.fields))
    }
  }, 120_000)
})

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
import { spawnSync } from 'node:child_process'
import path from 'node:path'

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


// ─────────────────────────────────────────────────────────────────────────────
// Le bloc ci-dessus couvre la LOGIQUE. Il était vert alors que le contrôle ne
// s'exécutait jamais : la garde « ne lancer la CLI que si lancé directement »
// comparait `import.meta.url` à `file://${process.argv[1]}`, qui ne correspond
// JAMAIS sous Windows (argv[1] est `C:\...`, import.meta.url est
// `file:///C:/...`). `npm run verify:rotation` sortait donc 0 sans comparer une
// seule empreinte — un vert trompeur sur un contrôle de sécurité, invisible pour
// un test qui n'appelle que la fonction.
//
// Ces cas exercent le POINT D'ENTRÉE réel, sur la plateforme cible du produit.
// ─────────────────────────────────────────────────────────────────────────────
describe('point d’entrée CLI — la garde doit déclencher sur la plateforme hôte', () => {
  const SCRIPT = path.resolve(__dirname, '../../../scripts/verify-rotation.mjs')

  /** Lance la CLI avec un environnement MINIMAL et maîtrisé (aucun vrai secret). */
  function lancer(env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      // `env` repart de zéro : un secret réel du poste ne doit pas influencer le
      // test. `NODE_ENV` est requis par l'augmentation de `ProcessEnv` que Next
      // installe ; l'omettre casse `tsc --noEmit` sans rien changer au test.
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        NODE_ENV: 'test' as const,
        ...env,
      },
    })
  }

  it('produit réellement son rapport (la garde ne doit pas être un no-op)', () => {
    const r = lancer()
    expect(r.error, `lancement impossible: ${r.error?.message}`).toBeUndefined()
    // Sans cette sortie, main() n'a pas été appelé : le contrôle n'a rien vérifié.
    expect(`${r.stdout}`).toContain('Preuve de rotation des secrets')
  })

  it('une valeur hors manifeste sort 0 et reste « non vérifiable », jamais « rotée »', () => {
    // Un environnement sans les vrais secrets ne doit JAMAIS produire un vert
    // d'apparence probante : le verdict honnête est « non vérifiable ». Le cas
    // « valeur encore compromise » est couvert sans secret réel par le bloc
    // checkRotation ci-dessus (manifeste synthétique) ; le reproduire ici
    // demanderait d'écrire une vraie valeur compromise dans un test.
    const r = lancer({ GARAGEFLOW_API_KEY: 'x' })
    expect(r.status).toBe(0)
    expect(`${r.stdout}`).toContain('rotation non vérifiable')
    expect(`${r.stdout}`).not.toContain('prouvé(s) roté(s), 0 non vérifiable')
  })

  it('n’écrit aucune VALEUR de secret sur ses sorties', () => {
    const sentinelle = 'valeur-sentinelle-ne-doit-pas-fuiter-0123456789'
    const r = lancer({ GARAGEFLOW_API_KEY: sentinelle, NEXTAUTH_SECRET: sentinelle })
    expect(`${r.stdout}${r.stderr}`).not.toContain(sentinelle)
  })
})

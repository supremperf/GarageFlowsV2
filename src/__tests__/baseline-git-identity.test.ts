/**
 * GF31-AUD-065 — la baseline canonique ne se régénérait pas hors dépôt git.
 *
 * `generate-verification-baseline.mjs` appelait `git rev-parse` sans repli :
 * hors dépôt, la génération s'arrêtait sur `fatal: not a git repository` et le
 * document canonique restait **figé sur une mesure ancienne** — 1541 tests
 * affichés alors que la suite en comptait 2255.
 *
 * Une baseline périmée est pire qu'absente : elle contredit silencieusement
 * tout le reste de la documentation, et c'est exactement la divergence que ce
 * fichier existe pour empêcher (§165).
 *
 * La correction distingue « pas de commit » de « échec de génération ». Sans
 * identité, la baseline reste MESURÉE et le dit ; l'exigence d'identité pour un
 * ARTEFACT, elle, ne bouge pas — `verify-artifact` continue d'exiger 40 hex.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const script = () => readFileSync(path.join(ROOT, 'scripts/generate-verification-baseline.mjs'), 'utf8')

describe('GF31-AUD-065 — identité git optionnelle, jamais silencieuse', () => {
  it('le générateur ne plante plus quand git est absent', () => {
    const s = script()
    expect(s).toContain('function gitOrNull')
    // Plus aucun appel git NU dans la construction de la baseline.
    expect(s).not.toMatch(/commit:\s*sh\('git rev-parse HEAD'\)/)
    expect(s).not.toMatch(/branch:\s*sh\('git rev-parse --abbrev-ref HEAD'\)/)
  })

  it('l’absence d’identité est déclarée dans la donnée ET à l’écran', () => {
    const s = script()
    expect(s).toContain('gitIdentity')
    expect(s).toContain('HORS DÉPÔT GIT')
    expect(s).toMatch(/Rejouez-la depuis le dépôt/)
  })

  it('la baseline produite porte des comptes MESURÉS, jamais inventés', () => {
    const p = path.join(ROOT, 'artifacts/verification/baseline.json')
    if (!existsSync(p)) return // pas encore générée dans cet environnement
    const b = JSON.parse(readFileSync(p, 'utf8'))
    expect(b.tests.measured).toBe(true)
    expect(b.tests.total).toBeGreaterThan(0)
    expect(b.tests.passed + b.tests.failed + b.tests.skipped).toBe(b.tests.total)
    // Et l'identité est explicite dans les deux cas.
    expect(typeof b.gitIdentity).toBe('boolean')
    if (b.gitIdentity) expect(b.commit).toMatch(/^[0-9a-f]{40}$/)
    else expect(b.commit).toBeNull()
  })

  it('l’exigence d’identité pour un ARTEFACT reste intacte', () => {
    // Le relâchement porte sur la BASELINE (une mesure), pas sur l'artefact
    // distribué (une identité de build). Confondre les deux ouvrirait la porte
    // à une release non rattachable à son commit (§150).
    const verify = readFileSync(path.join(ROOT, 'scripts/verify-artifact.mjs'), 'utf8')
    expect(verify).toMatch(/40 hex attendu/)
    expect(verify).toContain('buildId')
  })
})

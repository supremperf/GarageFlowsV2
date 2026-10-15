/**
 * Garde-fou de cohérence documentaire (V13.1) — tests du garde lui-même.
 *
 * Prouve que `checkDocsConsistency` ÉCHOUE sur des dossiers documentaires
 * volontairement incohérents (double source canonique, compte de tests
 * contradictoire, revendication canonique hors baseline, statut trop favorable)
 * et PASSE sur un dossier cohérent — y compris les cas légitimes qui ne doivent
 * PAS être flaggés (petit compte par-suite, pointeur vers la baseline, doc
 * historique/journal).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Le cœur du garde est un module .mjs sous scripts/ (hors alias @/).
import { checkDocsConsistency } from '../../scripts/lib/docs-consistency.mjs'

const BASELINE = { tests: { total: 1351, passed: 1323 } }
const CANON_REL = 'docs/audit/FINAL_VERIFICATION_BASELINE.md'
const CANON_MARK = '<!-- doc-role: canonical-baseline -->'

let root: string
const write = (rel: string, content: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}
const run = () => checkDocsConsistency(root, { baseline: BASELINE })
const kinds = () => run().violations.map((v: { kind: string }) => v.kind)

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'gf-docs-')) })
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

function resetCleanCorpus() {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  // Corpus cohérent minimal.
  write(CANON_REL, `${CANON_MARK}\n# Canonical baseline\n\n1351 tests, 1323 passed.\n`)
  write('docs/README.md', 'Voir la baseline canonique pour l’état courant.\n')
  write('docs/perf.md', 'Isolation : 63 tests verts. Authz : 128 cellules.\n') // petits comptes OK
  write('WORKLOG.md', '<!-- doc-numbers: journal -->\n# Journal\n\n1040 tests verts le 2026-08-06.\n')
  write('docs/old.md', '<!-- doc-status: historique -->\n# Ancien\n\n694 tests verts, production ready.\n')
}

describe('docs-consistency — corpus cohérent', () => {
  it('PASSE (aucune violation) et ne flague pas les cas légitimes', () => {
    resetCleanCorpus()
    const r = run()
    expect(r.violations, JSON.stringify(r.violations)).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('docs-consistency — incohérences détectées', () => {
  it('double source canonique → FAIL', () => {
    resetCleanCorpus()
    write('docs/other-baseline.md', `${CANON_MARK}\n# Une autre baseline canonique\n`)
    expect(kinds()).toContain('canonical-count')
  })

  it('aucune source canonique → FAIL', () => {
    rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
    write('docs/x.md', '# rien de canonique\n')
    expect(kinds()).toContain('canonical-count')
  })

  it('compte de tests courant contradictoire → FAIL', () => {
    resetCleanCorpus()
    write('docs/brag.md', 'La suite compte 9999 tests verts actuellement.\n')
    expect(kinds()).toContain('test-count')
  })

  it('petit compte par-suite (< 1000) → PAS de flag', () => {
    resetCleanCorpus()
    write('docs/suite.md', 'Le module d’isolation : 63 tests verts ; authz 128 tests passés.\n')
    expect(kinds()).not.toContain('test-count')
  })

  it('revendication canonique hors baseline → FAIL', () => {
    resetCleanCorpus()
    write('docs/rogue.md', '# Rogue\n\nCe document est la seule source de vérité du projet.\n')
    expect(kinds()).toContain('canonical-claim')
  })

  it('revendication canonique EN POINTEUR vers la baseline → PAS de flag', () => {
    resetCleanCorpus()
    write('docs/pointer.md', 'See FINAL_VERIFICATION_BASELINE.md for the single source of truth.\n')
    expect(kinds()).not.toContain('canonical-claim')
  })

  it('statut « production ready » dans un doc actif → FAIL', () => {
    resetCleanCorpus()
    write('docs/status.md', '# État\n\nLe produit est production ready.\n')
    expect(kinds()).toContain('status')
  })

  it('compte ancien dans un doc HISTORIQUE ou JOURNAL → PAS de flag', () => {
    resetCleanCorpus() // contient déjà old.md (historique, 694) et WORKLOG (journal, 1040)
    expect(kinds()).not.toContain('test-count')
    expect(kinds()).not.toContain('status') // "production ready" dans le doc historique est ignoré
  })
})

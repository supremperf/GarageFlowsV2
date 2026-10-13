/**
 * GF31-AUD-066 — la garde documentaire jugeait sur des résidus ignorés.
 *
 * `checkDocsConsistency` parcourait le disque en n'écartant que `node_modules`,
 * `.next` et `.git`. Un ancien worktree laissé sous `.claude/` — ignoré par
 * `.gitignore`, invisible pour quiconque relit le dépôt — embarquait sa propre
 * copie de la baseline canonique. La porte de release annonçait alors
 * « 2 sources canoniques déclarées (attendu : 1) » sur un dépôt qui n'en suit
 * qu'UNE, et refusait la livraison.
 *
 * Constaté sur le dépôt réel le 2026-08-13 : le gate échouait deux fois
 * (`check:consistency` et `Cohérence documentaire`) là où la copie de travail,
 * dépourvue de ce résidu, passait au vert. Un verdict de porte qui dépend de ce
 * qui traîne en local n'est pas un verdict.
 *
 * La correction interroge git — fichiers suivis PLUS non suivis non ignorés —
 * et ne retombe sur le disque que hors dépôt. Ce fichier verrouille les deux
 * moitiés : l'ignoré cesse de compter, ET tout le reste continue de compter.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkDocsConsistency } from '../../scripts/lib/docs-consistency.mjs'

const BASELINE = { tests: { total: 1351, passed: 1323 } }
const CANON_REL = 'docs/audit/FINAL_VERIFICATION_BASELINE.md'
const CANON_MARK = '<!-- doc-role: canonical-baseline -->'
const CANON_BODY = `${CANON_MARK}\n# Canonical baseline\n\n1351 tests, 1323 passed.\n`

const gitDisponible = (() => {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })
  return !r.error && r.status === 0
})()

const racines: string[] = []
afterAll(() => { for (const r of racines) rmSync(r, { recursive: true, force: true }) })

let root: string
const write = (rel: string, content: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}
const violations = () => checkDocsConsistency(root, { baseline: BASELINE }).violations
const kinds = () => violations().map((v: { kind: string }) => v.kind)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gf-docs-residu-'))
  racines.push(root)
  write(CANON_REL, CANON_BODY)
  write('docs/README.md', 'Voir la baseline canonique pour l’état courant.\n')
})

const initGit = () => spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true })

describe.skipIf(!gitDisponible)('GF31-AUD-066 — inventaire par git, pas par le disque', () => {
  it('un worktree oublié sous .claude/ ne compte plus comme seconde source canonique', () => {
    initGit()
    write('.gitignore', '.claude/\nnode_modules\n')
    // Le résidu exact rencontré sur le dépôt : une baseline canonique complète,
    // avec son marqueur, dans un ancien worktree ignoré.
    write('.claude/worktrees/blackscreen/docs/audit/FINAL_VERIFICATION_BASELINE.md', CANON_BODY)

    expect(kinds()).not.toContain('canonical-count')
  })

  it('mais un VRAI doublon, lui, est toujours refusé', () => {
    initGit()
    write('.gitignore', '.claude/\nnode_modules\n')
    // Même fichier, cette fois à un emplacement suivi : c'est une authentique
    // divergence documentaire, et elle doit continuer d'arrêter la porte.
    write('docs/audit/COPIE_BASELINE.md', CANON_BODY)

    expect(kinds()).toContain('canonical-count')
  })

  it('un doublon tout juste écrit, pas encore `git add`, est vu lui aussi', () => {
    initGit()
    write('.gitignore', '.claude/\n')
    // `--others --exclude-standard` : c'est la propriété qui distingue « non
    // suivi » de « ignoré ». La confondre rouvrirait un faux vert — un second
    // canonique passerait tant qu'il n'est pas indexé.
    write('docs/nouvelle-baseline.md', CANON_BODY)

    expect(kinds()).toContain('canonical-count')
  })
})

describe('GF31-AUD-066 — hors dépôt, le repli disque exclut aussi l’outillage', () => {
  it('sans git, .claude/ et les sorties de build ne sont pas des documents', () => {
    // Pas de `git init` : dossier temporaire nu, exactement le cas d'une copie
    // de travail détachée (celle où l'audit a tourné). Le repli doit rester
    // utilisable — dégradé, jamais silencieux (cf. GF31-AUD-065).
    write('.claude/worktrees/x/docs/audit/FINAL_VERIFICATION_BASELINE.md', CANON_BODY)
    write('dist/docs/FINAL_VERIFICATION_BASELINE.md', CANON_BODY)

    expect(kinds()).not.toContain('canonical-count')
  })

  it('et le repli continue de voir les vrais documents', () => {
    write('docs/audit/COPIE_BASELINE.md', CANON_BODY)

    expect(kinds()).toContain('canonical-count')
  })
})

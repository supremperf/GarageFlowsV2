/**
 * Garde-fou baseline canonique ↔ machine (V15.1) — anti-régression.
 *
 * Reproduit précisément les deux bugs V15 et prouve qu'ils sont désormais
 * DÉTECTÉS :
 *   A) le doc annonce 1360/1332 alors que la machine mesure 1396/1368 → FAIL ;
 *   B) le doc annonce Prisma 5.16.1 alors que la machine résout 5.22.0 → FAIL ;
 *   C) doc et machine parfaitement synchronisés → PASS.
 * Plus : bloc AUTO absent → FAIL ; round-trip render→parse fidèle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkCanonicalBaseline } from '../../scripts/lib/docs-consistency.mjs'
import { renderAutoBlock, parseAutoBlock } from '../../scripts/lib/baseline-doc.mjs'

const CANON_REL = 'docs/audit/FINAL_VERIFICATION_BASELINE.md'
const CANON_MARK = '<!-- doc-role: canonical-baseline -->'

/** Baseline machine complète (v2) — surchargeable. */
function machineBaseline(over: any = {}) {
  const base = {
    commitShort: 'abcdef0',
    branch: 'test',
    generatedAtUtc: '2026-08-07T00:00:00.000Z',
    toolchain: {
      node: 'v22.22.2', npm: '10.9.7', os: 'linux x64',
      dependencies: {
        next: { declared: '^14.2.35', resolved: '14.2.35' },
        react: { declared: '^18.3.1', resolved: '18.3.1' },
        'react-dom': { declared: '^18.3.1', resolved: '18.3.1' },
        typescript: { declared: '^5', resolved: '5.9.3' },
        prisma: { declared: '^5.16.1', resolved: '5.22.0' },
        '@prisma/client': { declared: '^5.16.1', resolved: '5.22.0' },
        electron: { declared: '^31.7.7', resolved: '31.7.7' },
        vitest: { declared: '^4.1.5', resolved: '4.1.5' },
      },
    },
    tests: { measured: true, files: 129, total: 1396, discovered: 1396, passed: 1368, failed: 0, skipped: 28 },
  }
  return { ...base, ...over, toolchain: { ...base.toolchain, ...(over.toolchain ?? {}) }, tests: { ...base.tests, ...(over.tests ?? {}) } }
}

let root: string
const writeCanon = (autoSourceBaseline: any | null) => {
  const p = join(root, CANON_REL)
  mkdirSync(join(p, '..'), { recursive: true })
  const block = autoSourceBaseline ? renderAutoBlock(autoSourceBaseline) : '(pas de bloc auto)'
  writeFileSync(p, `${CANON_MARK}\n# Canonical baseline\n\n${block}\n`)
}
const kinds = (b: any) => checkCanonicalBaseline(root, b).map((v: { kind: string }) => v.kind)

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gf-baseline-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('checkCanonicalBaseline (V15.1)', () => {
  it('Test A — comptes de tests divergents (doc 1360/1332 vs machine 1396/1368) → FAIL', () => {
    // Doc rendu depuis d'ANCIENS chiffres ; on contrôle contre la machine actuelle.
    writeCanon(machineBaseline({ tests: { files: 120, total: 1360, discovered: 1360, passed: 1332, failed: 0, skipped: 28 } }))
    expect(kinds(machineBaseline())).toContain('baseline-test-count')
  })

  it('Test B — Prisma divergent (doc 5.16.1 vs machine 5.22.0) → FAIL', () => {
    const docBaseline = machineBaseline()
    docBaseline.toolchain.dependencies.prisma = { declared: '^5.16.1', resolved: '5.16.1' }
    docBaseline.toolchain.dependencies['@prisma/client'] = { declared: '^5.16.1', resolved: '5.16.1' }
    writeCanon(docBaseline)
    expect(kinds(machineBaseline())).toContain('baseline-toolchain')
  })

  it('Test C — doc et machine synchronisés → PASS (aucune violation)', () => {
    const b = machineBaseline()
    writeCanon(b)
    expect(checkCanonicalBaseline(root, b)).toEqual([])
  })

  it('bloc AUTO absent → FAIL (baseline-auto-missing)', () => {
    writeCanon(null)
    expect(kinds(machineBaseline())).toContain('baseline-auto-missing')
  })

  it('baseline non-v2 (sans toolchain.dependencies) → contrôle inactif (rétro-compat)', () => {
    writeCanon(null)
    expect(checkCanonicalBaseline(root, { tests: { total: 10, passed: 10 } })).toEqual([])
  })
})

describe('baseline-doc — round-trip render → parse', () => {
  it('les valeurs rendues sont relues à l’identique', () => {
    const b = machineBaseline()
    const doc = `${CANON_MARK}\n${renderAutoBlock(b)}\n`
    const parsed = parseAutoBlock(doc)!
    expect(parsed.tests).toEqual({ files: 129, discovered: 1396, passed: 1368, failed: 0, skipped: 28 })
    expect(parsed.versions.prisma).toBe('5.22.0')
    expect(parsed.versions.typescript).toBe('5.9.3')
    expect(parsed.versions['@prisma/client']).toBe('5.22.0')
  })
})

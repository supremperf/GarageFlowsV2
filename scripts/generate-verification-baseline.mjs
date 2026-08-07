#!/usr/bin/env node
/**
 * generate-verification-baseline.mjs — métadonnées de vérification (V13.1).
 *
 * Produit `artifacts/verification/baseline.json` : la SEULE représentation
 * machine du commit, de la toolchain et des comptes de tests. Objectif
 * anti-divergence : plus aucun SHA ni compte de tests recopié à la main dans
 * quinze documents. La documentation cite ce fichier ; le garde-fou
 * `check-docs-consistency.mjs` vérifie que rien ne le contredit.
 *
 * Comptes de tests : lus depuis `artifacts/verification/test-results.json`
 * (rapport JSON de vitest) s'il existe. Sinon, marqués « not-measured » —
 * JAMAIS inventés.
 *
 * Usage :
 *   npx vitest run --reporter=json --outputFile=artifacts/verification/test-results.json
 *   node scripts/generate-verification-baseline.mjs
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'verification')
const OUT = join(OUT_DIR, 'baseline.json')
const TEST_RESULTS = join(OUT_DIR, 'test-results.json')

const sh = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const dep = (n) => (pkg.dependencies?.[n] || pkg.devDependencies?.[n] || 'n/a').replace(/^[\^~]/, '')

/** Extrait total/passed/failed/skipped d'un rapport JSON vitest (si présent). */
function readTestCounts() {
  if (!existsSync(TEST_RESULTS)) {
    return { measured: false, note: 'test-results.json absent — lancer vitest --reporter=json' }
  }
  try {
    const r = JSON.parse(readFileSync(TEST_RESULTS, 'utf8'))
    // Format vitest : numTotalTests / numPassedTests / numFailedTests / numPendingTests.
    const total = r.numTotalTests ?? 0
    const passed = r.numPassedTests ?? 0
    const failed = r.numFailedTests ?? 0
    const skipped = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0)
    const files = r.testResults?.length ?? null
    const suites = r.numTotalTestSuites ?? null
    return { measured: true, files, suites, total, passed, failed, skipped }
  } catch (e) {
    return { measured: false, note: `test-results.json illisible : ${e.message}` }
  }
}

const baseline = {
  _note: 'Généré par scripts/generate-verification-baseline.mjs — NE PAS éditer à la main. Source machine unique du commit/toolchain/comptes de tests (anti-divergence V13.1).',
  product: 'GarageFlows',
  version: pkg.version,
  commit: sh('git rev-parse HEAD'),
  commitShort: sh('git rev-parse --short HEAD'),
  branch: sh('git rev-parse --abbrev-ref HEAD'),
  generatedAtUtc: new Date().toISOString(),
  toolchain: {
    node: process.version,
    npm: (() => { try { return sh('npm --version') } catch { return 'n/a' } })(),
    os: `${process.platform} ${process.arch}`,
    next: dep('next'),
    prisma: dep('@prisma/client'),
    electron: dep('electron'),
    typescript: dep('typescript'),
    postgresTested: process.env.TEST_POSTGRES_URL ? 'yes (local/service)' : 'not in this run',
    redisTested: process.env.TEST_REDIS_URL ? 'yes (local/service)' : 'not in this run',
  },
  tests: readTestCounts(),
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n')
console.log(`✅ ${OUT.replace(ROOT + '/', '')} écrit :`)
console.log(`   commit ${baseline.commitShort} · version ${baseline.version} · Node ${baseline.toolchain.node}`)
console.log(`   tests : ${baseline.tests.measured ? `${baseline.tests.passed}/${baseline.tests.total} (${baseline.tests.skipped} ignorés)` : baseline.tests.note}`)

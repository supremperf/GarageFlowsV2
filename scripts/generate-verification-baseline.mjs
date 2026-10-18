#!/usr/bin/env node
/**
 * generate-verification-baseline.mjs — métadonnées de vérification (V13.1 → V15.1).
 *
 * Produit `artifacts/verification/baseline.json` : la SEULE représentation
 * machine du commit, de la toolchain et des comptes de tests. Objectif
 * anti-divergence : plus aucun SHA, compte de tests NI version de dépendance
 * recopié/interprété à la main. La documentation cite ce fichier ; le garde-fou
 * `check-docs-consistency.mjs` vérifie que rien ne le contredit — y compris la
 * baseline canonique humaine elle-même.
 *
 * Versions de toolchain : la version RÉSOLUE (réellement installée / verrouillée)
 * est distinguée de la PLAGE DÉCLARÉE du package.json. On ne présente JAMAIS
 * « ^5.16.1 » tronqué en « 5.16.1 installé » (cf. scripts/lib/toolchain-versions).
 *
 * Comptes de tests : lus depuis `artifacts/verification/test-results.json`
 * (rapport JSON de vitest) s'il existe. Sinon, marqués « not-measured » —
 * JAMAIS inventés. Un invariant incohérent fait ÉCHOUER la génération.
 *
 * Effet de bord : met à jour le bloc AUTO-GÉNÉRÉ de
 * `docs/audit/FINAL_VERIFICATION_BASELINE.md` (entre les marqueurs BEGIN/END) à
 * partir de la baseline fraîche — le reste du document (prose humaine) est intact.
 *
 * Usage :
 *   npx vitest run --reporter=json --outputFile=artifacts/verification/test-results.json
 *   node scripts/generate-verification-baseline.mjs
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDependencyMap } from './lib/toolchain-versions.mjs'
import { renderAutoBlock, replaceAutoBlock } from './lib/baseline-doc.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'verification')
const OUT = join(OUT_DIR, 'baseline.json')
const TEST_RESULTS = join(OUT_DIR, 'test-results.json')
const CANONICAL_DOC = join(ROOT, 'docs', 'audit', 'FINAL_VERIFICATION_BASELINE.md')

const sh = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** package-lock.json parsé (verrouillage des versions résolues), ou null. */
function readLock() {
  const p = join(ROOT, 'package-lock.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/** Version réellement installée dans node_modules/<name>/package.json, ou null. */
function readInstalled(name) {
  const p = join(ROOT, 'node_modules', name, 'package.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')).version ?? null } catch { return null }
}

/** Extrait total/passed/failed/skipped d'un rapport JSON vitest (si présent). */
function readTestCounts() {
  if (!existsSync(TEST_RESULTS)) {
    return { measured: false, note: 'test-results.json absent — lancer vitest --reporter=json' }
  }
  let r
  try {
    r = JSON.parse(readFileSync(TEST_RESULTS, 'utf8'))
  } catch (e) {
    return { measured: false, note: `test-results.json illisible : ${e.message}` }
  }
  // Format vitest : numTotalTests / numPassedTests / numFailedTests / numPendingTests.
  const total = r.numTotalTests ?? 0
  const passed = r.numPassedTests ?? 0
  const failed = r.numFailedTests ?? 0
  const skipped = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0)
  const files = r.testResults?.length ?? null
  const suites = r.numTotalTestSuites ?? null
  // Invariants : refuse un état incohérent plutôt que de publier un chiffre faux.
  const problems = []
  if (passed < 0 || failed < 0 || skipped < 0) problems.push('compte négatif')
  if (total < passed + failed) problems.push(`total(${total}) < passed(${passed}) + failed(${failed})`)
  if (problems.length) {
    throw new Error(`Comptes de tests incohérents (${problems.join(' ; ')}) — génération refusée.`)
  }
  return { measured: true, files, suites, total, discovered: total, passed, failed, skipped }
}

/**
 * Identité git, ou `null` hors dépôt (GF31-AUD-065).
 *
 * Les trois appels `git` n'avaient aucun repli : hors dépôt, la génération
 * s'arrêtait sur `fatal: not a git repository` et la baseline canonique restait
 * FIGÉE sur une mesure ancienne — 1541 tests affichés alors que la suite en
 * comptait 2255. Une baseline périmée est pire qu'absente : elle contredit
 * silencieusement tout le reste de la documentation, et c'est précisément la
 * divergence que ce fichier existe pour empêcher.
 *
 * On distingue donc « pas de commit » de « échec de génération ». Sans identité,
 * la baseline reste MESURÉE et honnête ; c'est `verify-artifact` qui refuse un
 * artefact sans commit (40 hex exigés), et cette exigence-là ne bouge pas.
 */
function gitOrNull(cmd) {
  try { return sh(cmd) } catch { return null }
}

const commit = gitOrNull('git rev-parse HEAD')
const lock = readLock()
const baseline = {
  _note: 'Généré par scripts/generate-verification-baseline.mjs — NE PAS éditer à la main. Source machine unique du commit/toolchain/comptes de tests (anti-divergence).',
  schemaVersion: 2,
  product: 'GarageFlows',
  version: pkg.version,
  commit,
  commitShort: commit ? gitOrNull('git rev-parse --short HEAD') : null,
  branch: commit ? gitOrNull('git rev-parse --abbrev-ref HEAD') : null,
  // Explicite : un consommateur ne doit pas avoir à deviner pourquoi le commit
  // est nul. `false` = mesure faite hors dépôt, identité de build absente.
  gitIdentity: Boolean(commit),
  generatedAtUtc: new Date().toISOString(),
  toolchain: {
    node: process.version,
    npm: (() => { try { return sh('npm --version') } catch { return 'n/a' } })(),
    os: `${process.platform} ${process.arch}`,
    // Versions RÉSOLUES (installées/verrouillées) + PLAGE déclarée, par composant.
    dependencies: buildDependencyMap(pkg, { readInstalled, lock }),
    postgresTested: process.env.TEST_POSTGRES_URL ? 'yes (local/service)' : 'not in this run',
    redisTested: process.env.TEST_REDIS_URL ? 'yes (local/service)' : 'not in this run',
  },
  tests: readTestCounts(),
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n')

// Met à jour le bloc AUTO de la baseline humaine (prose intacte).
let docStatus = 'non trouvée'
let before = null
try { before = readFileSync(CANONICAL_DOC, 'utf8') } catch { /* absente : docStatus le dit */ }
if (before !== null) {
  const after = replaceAutoBlock(before, renderAutoBlock(baseline))
  if (after == null) {
    docStatus = 'marqueurs AUTO absents (ajoutez BEGIN/END AUTO-GENERATED BASELINE)'
  } else if (after !== before) {
    writeFileSync(CANONICAL_DOC, after)
    docStatus = 'bloc AUTO mis à jour'
  } else {
    docStatus = 'déjà à jour'
  }
}

const prisma = baseline.toolchain.dependencies.prisma
console.log(`✅ ${OUT.replace(ROOT + '/', '')} écrit :`)
console.log(`   commit ${baseline.commitShort ?? '—'} · version ${baseline.version} · Node ${baseline.toolchain.node}`)
if (!baseline.gitIdentity) {
  console.log('   ⚠️  HORS DÉPÔT GIT : les comptes sont mesurés, mais la baseline ne porte')
  console.log('      AUCUNE identité de build. Rejouez-la depuis le dépôt avant un tag.')
}
console.log(`   Prisma résolu ${prisma.resolved ?? prisma.status} (déclaré ${prisma.declared})`)
console.log(`   tests : ${baseline.tests.measured ? `${baseline.tests.passed}/${baseline.tests.total} (${baseline.tests.skipped} ignorés)` : baseline.tests.note}`)
console.log(`   doc canonique : ${docStatus}`)

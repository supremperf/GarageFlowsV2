'use strict'
// Reconstructs evidence indexes only. Does not certify manual source review.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '../../..'), evidence = path.join(__dirname, 'evidence')
const source = 'vitest-final.json', report = JSON.parse(fs.readFileSync(path.join(evidence, source)))
const relative = value => path.relative(root, value).replaceAll('\\', '/')
const write = (name, rows) => fs.writeFileSync(path.join(__dirname, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const all = [], skipped = [], failed = [], setup = [], categories = {}
for (const [fi, file] of report.testResults.entries()) {
  const name = relative(file.name), setupNetwork = /db push --skip-generate --accept-data-loss/.test(file.message || '')
  const setupEngine = /could not locate the Query Engine/.test(file.message || '')
  if (file.status === 'failed' && (setupNetwork || setupEngine)) setup.push({ file: name, evidence: `${source}#/testResults/${fi}/message`, message: file.message, category: setupNetwork ? 'PRISMA_DB_PUSH_FAILED' : 'PRISMA_RUNTIME_ENGINE_MISSING', status: 'BLOQUÉ' })
  for (const [ti, test] of file.assertionResults.entries()) {
    const row = { file: name, name: test.fullName, runnerStatus: test.status, evidence: `${source}#/testResults/${fi}/assertionResults/${ti}` }
    if (test.status === 'failed') {
      Object.assign(row, { status: 'ÉCHOUÉ', issue: 'FUP-20261014-002', cause: 'Échec de construction du modèle SQLite : commande Prisma db push, stderr natif conservé.', prerequisite: 'Téléchargements officiels vérifiés et génération normale Prisma, puis relancer chacun des trois tests et la suite entière.', failures: test.failureMessages })
      failed.push(row)
    } else if (test.status === 'skipped' || test.status === 'pending') {
      let category, cause, prerequisite, issue
      if (file.status === 'failed' && (setupNetwork || setupEngine)) {
        category = 'SETUP_FAILURE_NOT_DECLARED_SKIP'; cause = setupNetwork ? 'Corps non exécuté après échec du hook : Prisma db push échoue (moteur/téléchargement), voir erreur partagée du fichier.' : 'Corps non exécuté après échec du hook : Query Engine Prisma introuvable.'
        prerequisite = 'Rétablir moteurs officiels vérifiés, npm ci normal et génération normale des deux clients ; relancer ce fichier puis toute la suite.'; issue = 'FUP-20261014-002'
      } else if (name.includes('postgres.int.test')) {
        category = 'DECLARED_POSTGRES_UNAVAILABLE'; cause = 'Condition de suite : TEST_POSTGRES_URL absent ; PostgreSQL de test isolé non provisionné.'; prerequisite = 'Provisionner PostgreSQL isolé avec droit de créer des bases de test ; renseigner TEST_POSTGRES_URL via configuration autorisée, jamais une DB de production.'; issue = 'FUP-20261014-017'
      } else if (name.endsWith('rate-limit-multi-instance.int.test.ts')) {
        category = 'DECLARED_REDIS_UNAVAILABLE'; cause = 'describe.skipIf(!REDIS) ; TEST_REDIS_URL absent.'; prerequisite = 'Provisionner Redis isolé et TEST_REDIS_URL ; exécuter la preuve multi-instance réelle.'; issue = 'FUP-20261014-017'
      } else if (name.endsWith('license-public-key.test.ts')) {
        category = 'DECLARED_EXTERNAL_PUBLIC_KEY_ABSENT'; cause = 'it.skipIf(!existsSync(PEM)) : keys/public.pem absent.'; prerequisite = 'Comparer l’ancre à la clé publique authentifiée de l’émetteur autorisé. Restaurer une copie des ancres embarquées ne constitue pas cette attestation.'; issue = 'FUP-20261014-007'
      } else if (name.endsWith('forgery-resistance.test.ts')) {
        if (test.fullName.includes('correspond à keys/public.pem')) {
          category = 'DECLARED_EXTERNAL_PUBLIC_KEY_ABSENT'; cause = 'keys/public.pem émettrice absente.'; prerequisite = 'Clé publique émettrice authentifiée, comparaison indépendante.'
        } else {
          category = 'DECLARED_ISSUER_PRIVATE_KEY_ABSENT'; cause = 'it.skipIf(SANS_CLE) : clé privée émettrice non disponible ; aucun remplacement ni rotation effectué.'; prerequisite = 'Exécuter sur le poste de signature autorisé, sans copier la clé privée dans CI/chat/dépôt ; conserver des preuves expurgées.'
        }
        issue = 'FUP-20261014-007'
      } else if (name.endsWith('public-key-consistency.test.ts')) {
        category = 'DECLARED_ISSUED_TOKEN_ABSENT'; cause = 'GF_TEST_LICENSE absent : les deux tests nécessitent un jeton réellement émis par le keygen autorisé.'; prerequisite = 'Utiliser un jeton de recette autorisé dans un environnement isolé ; ne pas le publier dans les preuves.'; issue = 'FUP-20261014-007'
      } else if (name.endsWith('integrity-diagnostics.test.ts')) {
        category = 'DECLARED_REAL_ARTIFACT_ABSENT'; cause = 'Manifeste de dist/win-unpacked/resources absent ; ancien retour anticipé vert remplacé par absence explicite de validation.'; prerequisite = 'npm run dist sur Windows puis GF_REQUIRE_ARTIFACT_TEST=1 npx vitest run src/__tests__/integrity-diagnostics.test.ts ; absence doit échouer.'; issue = 'FUP-20261014-013'
      } else throw new Error(`Unclassified skipped test: ${name}: ${test.fullName}`)
      categories[category] = (categories[category] || 0) + 1
      Object.assign(row, { status: category.startsWith('SETUP_') ? 'NON EXÉCUTÉ' : 'BLOQUÉ', category, issue, cause, prerequisite, criticality: /auth|tenant|licen[cs]e|forgery|session|isolation|password|security|stock|numbering|money|migration|backup|invoice|portal|mechanic|integrity/.test(name) ? 'ÉLEVÉE (classement conservateur de risque de non-validation)' : 'MOYENNE (classement provisoire, revue métier restante)' })
      skipped.push(row)
    } else Object.assign(row, { status: 'VALIDÉ', limitation: 'Statut runner seulement : ne prouve ni une couverture exhaustive ni une exécution réelle sans doubles de test.' })
    all.push(row)
  }
}
write('tests-all.jsonl', all); write('tests-skipped.jsonl', skipped); write('tests-failed.jsonl', failed); write('tests-setup-errors.jsonl', setup)
const plain = fs.readFileSync(path.join(evidence, 'vitest-final.log'), 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
const unhandled = []
for (const [index, line] of plain.split('\n').entries()) if (line.includes('This error originated in')) unhandled.push({ sequence: unhandled.length + 1, status: 'ÉCHOUÉ', origin: line.match(/"([^"]+)"/)?.[1], cause: 'PrismaClientInitializationError / Query Engine absent', evidence: `evidence/vitest-final.log:${index + 1}`, issue: 'FUP-20261014-002' })
write('tests-unhandled-errors.jsonl', unhandled)
const redis = JSON.parse(fs.readFileSync(path.join(evidence, 'redis-real-tests.json')));
const redisPassed = redis.testResults.flatMap(f => f.assertionResults).filter(t => t.status === 'passed');
if (redisPassed.length !== 5) throw new Error('Redis independent proof changed');
for (const row of all) if (row.file.endsWith('rate-limit-multi-instance.int.test.ts')) {
  if (!redisPassed.some(t => t.fullName === row.name)) throw new Error('Redis case reconciliation failed');
  row.independentValidation = { status:'VALIDÉ', evidence:'evidence/redis-real-tests.json', limitation:'Real Redis 8.10.2 via local REST shim; not upstream managed Upstash or CI Redis 7 runtime.' };
}
write('tests-all.jsonl', all);write('tests-skipped.jsonl', skipped);
const e2e = JSON.parse(fs.readFileSync(path.join(root, 'docs/audit/followup-2026-10-14/evidence/e2e.json'))), browser = []
function visit(suite, titles = []) {
  const chain = [...titles, suite.title].filter(Boolean)
  for (const spec of suite.specs || []) for (const test of spec.tests) {
    const skipped = test.expectedStatus === 'skipped' || test.results.every(r => r.status === 'skipped')
    browser.push({ file: spec.file, line: spec.line, name: [...chain, spec.title].join(' > '), project: test.projectName, criticality: skipped ? 'ÉLEVÉE (absence de preuve authentifiée ; classement conservateur)' : 'MOYENNE (absence de preuve navigateur ; classement provisoire)', runnerStatus: test.results.map(r => r.status), status: 'BLOQUÉ', issue: skipped ? 'FUP-20261014-016' : 'FUP-20261014-003', cause: skipped ? 'Identifiants/licence E2E de recette absents : exclusion déclarée, pas de validation authentifiée.' : 'Échec avant rendu : exécutable Chromium headless_shell-1234 absent.', prerequisite: skipped ? 'Compte et licence synthétiques sur cible de recette isolée autorisée ; aucune donnée/activation de production.' : 'Installer Chromium officiel et ses dépendances avec intégrité/TLS vérifiés, puis rejouer sur la copie SQLite de test.', annotations: test.annotations, errors: test.results.flatMap(r => r.errors || []) })
  }
  for (const child of suite.suites || []) visit(child, chain)
}
for (const suite of e2e.suites) visit(suite)
for (const row of browser) { row.historicalAttempt = true; row.currentExecution = 'NON EXÉCUTÉ'; row.evidence = '../followup-2026-10-14/evidence/e2e.json' }
write('tests-e2e.jsonl', browser)
const summary = {
  source, sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(evidence, source))).digest('hex'),
  total: all.length, passed: report.numPassedTests, failed: failed.length, skipped: skipped.length, categories,
  files: { total: report.testResults.length, failed: report.testResults.filter(f => f.status === 'failed').length, explicitlySkipped: report.testResults.filter(f => f.status !== 'failed' && f.assertionResults.length && f.assertionResults.every(t => t.status === 'skipped')).length, allBodiesSkippedAfterSetupFailure: report.testResults.filter(f => f.status === 'failed' && f.assertionResults.length && f.assertionResults.every(t => t.status === 'skipped')).length },
  unhandledErrors: unhandled.length, e2e: { total: browser.length, stats: e2e.stats, historicalSource: "../followup-2026-10-14/evidence/e2e.json", currentExecution: "NON EXÉCUTÉ", limitation: "Prior actual attempt retained; current --list is discovery only." },
  uniqueCoverageAcrossFullAndRedisRun: { total: all.length, passed: report.numPassedTests + redisPassed.length, failed: failed.length, notExecuted: skipped.length - redisPassed.length, caution: 'Separate executions. Full-run skipped results remain skipped; do not add overlapping targeted suite counts.' },
  limitations: ['Categories attach observed runner status to source skip conditions and shared hook errors; they do not certify every test implementation.', 'Criticality is conservative/provisional, not a completed per-scenario business-risk review.', 'Initial nominal 2896 passes included seven empty Python checks and one empty artifact check. Seven now execute the official Python keygen with an ephemeral test key; the artifact check is explicit locally and mandatory/fail-closed in the Windows workflow.', 'Python cross-language proof injects an ephemeral PUBLIC test key into the Node verifier; it does NOT validate the production issuer or a native Electron/browser runtime.'],
}
if (all.length !== 3829 || skipped.length !== 844 || failed.length !== 3 || unhandled.length !== 4 || browser.length !== 144) throw new Error('Observed totals changed: review classification before publishing')
fs.writeFileSync(path.join(__dirname, 'tests-summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))

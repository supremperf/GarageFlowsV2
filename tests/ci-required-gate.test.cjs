'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), { spawnSync } = require('node:child_process'), yaml = require('js-yaml')
const workflow = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'))
const gate = workflow.jobs['required-validation']
const required = ['dependency-security', 'secrets', 'base-verification', 'check', 'e2e', 'e2e-authenticated', 'windows-package']
test('mandatory gate rejects any failed, cancelled or skipped upstream job', () => {
  function run(failing, status) {
    const script = gate.steps[0].run.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_, name) => name === failing ? status : 'success')
    return spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8' }).status
  }
  assert.equal(run(null, 'success'), 0)
  for (const name of required) for (const status of ['failure', 'cancelled', 'skipped']) assert.notEqual(run(name, status), 0)
})
test('workflow graph pins actions, retains strict security and packages Windows before gate', () => {
  assert.equal(gate.if, '${{ always() }}')
  assert.deepEqual(gate.needs, required)
  assert.equal(workflow.permissions.contents, 'read')
  const base=workflow.jobs['base-verification']
  // L'étape de vérification de type standard doit EXISTER et échouer bruyamment.
  // Sa forme a changé le 16/10/2026 (mêmes commande et code de sortie, plus
  // des annotations d'erreur lisibles par API) : on vérifie donc la présence de
  // la commande ET la propagation du code de sortie, pas une chaîne figée.
  const tscStep = base.steps.find(s=>s.run?.includes('npx tsc --noEmit'))
  assert.ok(tscStep, 'le contrôle TypeScript standard a disparu du job de base')
  assert.match(tscStep.run, /exit \$statut/, 'le contrôle ne propage plus son code de sortie')
  assert.ok(base.steps.some(s=>s.run==='npm run build'))
  assert.ok(base.steps.some(s=>s.run?.includes('npm run check:perf-budget')))
  // Le plafond client est FIXÉ ici à dessein : c'est le garde-fou d'immutabilité
  // (le budget ne peut pas être relevé sans que ce test soit modifié sciemment).
  // Il a été relevé le 16/10/2026, mesure à l'appui — voir `raisedWhy` dans
  // perf-budget.json.
  assert.ok(base.steps.some(s=>s.run?.includes('totalClientJsBytes !== 3829408')))
  assert.equal(workflow.jobs['windows-package']['runs-on'], 'windows-latest')
  assert.ok(workflow.jobs['windows-package'].steps.some(s => s.run === 'npm run dist'))
  assert.ok(workflow.jobs['dependency-security'].steps.some(s => s.run === 'npm run audit:strict'))
  assert.equal(workflow.jobs.check.steps.find(s => s.name === 'Tests (unit + integration)').env.DATABASE_URL, 'file:./dev.db')
  for (const job of Object.values(workflow.jobs)) {
    assert.notEqual(job['continue-on-error'], true)
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/)
      assert.notEqual(step['continue-on-error'], true)
    }
  }
  for (const name of ['check', 'release-gate']) {
    const steps = workflow.jobs[name].steps
    assert.ok(steps.some(s => s.uses?.startsWith('actions/setup-python@')))
    assert.ok(steps.some(s => s.run?.includes('--require-hashes --only-binary=:all: -r tests/requirements-keygen.txt')))
  }
  const artifactTest = workflow.jobs['windows-package'].steps.find(s => s.run === 'npx vitest run src/__tests__/integrity-diagnostics.test.ts')
  assert.equal(artifactTest.env.GF_REQUIRE_ARTIFACT_TEST, '1')
  const install = workflow.jobs.secrets.steps.find(s => s.name === 'Install gitleaks').run
  assert.match(install, /sha256sum --check --strict/)
})

test('authenticated gate refuses missing fixtures, HTTP and known production targets without printing secrets', () => {
  const job = workflow.jobs['e2e-authenticated']
  assert.equal(job.environment, 'e2e-staging')
  const script = job.steps[0].run
  function run(overrides) {
    return spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', env: {
      PATH: process.env.PATH, BASE_URL: 'https://staging.example.test', E2E_EMAIL: 'audit@example.test',
      E2E_PASSWORD: 'synthetic-do-not-print', E2E_LICENSE: 'synthetic-token-do-not-print', E2E_NON_PRODUCTION: 'true', ...overrides,
    } })
  }
  assert.equal(run({}).status, 0) // prerequisite validator only: NO network/browser invocation
  for (const overrides of [
    { E2E_EMAIL: '' }, { E2E_PASSWORD: '' }, { E2E_LICENSE: '' }, { BASE_URL: '' }, { E2E_NON_PRODUCTION: '' },
    { BASE_URL: 'http://staging.example.test' }, { BASE_URL: 'https://garageflows.fr' },
    { BASE_URL: 'https://app.garageflows.fr' }, { BASE_URL: 'https://api.garageflows.fr' },
    { BASE_URL: 'https://www.garageflows.fr' }, { BASE_URL: 'https://garageflows.fr.' }, { BASE_URL: 'not-a-url' }, { BASE_URL: 'https://user:password@staging.example.test' },
  ]) {
    const result = run(overrides)
    assert.notEqual(result.status, 0)
    assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-do-not-print'))
    assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-token-do-not-print'))
  }
})

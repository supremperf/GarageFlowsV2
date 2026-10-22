'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { REQUIRED_CHECKS, evaluateManifest } = require('../scripts/production-readiness.cjs')

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeSums(root) {
  const evidence = path.join(root, 'artifacts', 'verification', 'evidence')
  const names = fs.readdirSync(evidence).filter((name) => name !== 'SHA256SUMS').sort()
  fs.writeFileSync(path.join(evidence, 'SHA256SUMS'), names.map((name) => `${digest(path.join(evidence, name))}  ${name}`).join('\n') + '\n')
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-production-readiness-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const evidence = path.join(root, 'artifacts', 'verification', 'evidence')
  fs.mkdirSync(evidence, { recursive: true })
  const checks = REQUIRED_CHECKS.map(([id, section]) => {
    const name = `${id}.txt`
    fs.writeFileSync(path.join(evidence, name), `COMMAND_EXIT=0\nPASS ${id}\n`)
    return {
      id,
      section,
      status: 'pass',
      exitCode: 0,
      command: 'fixture sans commande réelle',
      observedAt: '2026-10-22T00:00:00.000Z',
      reason: 'fixture de décision',
      evidence: [name],
      passMarker: `PASS ${id}`,
    }
  })
  const manifest = {
    schemaVersion: 1,
    generatedAt: '2026-10-22T00:00:00.000Z',
    baseCommit: '150654535ca0b3b417e96be057ba674a119c512f',
    branch: 'arena/388085e0-garageflowsv2',
    evidenceRoot: 'artifacts/verification/evidence',
    checks,
  }
  writeSums(root)
  return { root, manifest, evidence }
}

test('toutes les exigences passent seulement avec preuves, codes 0, marqueurs et empreintes valides', t => {
  const { root, manifest } = fixture(t)
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, true, result.errors.join('\n'))
  assert.equal(result.blocking, 0)
  assert.deepEqual(result.errors, [])
})

test('une exigence critique absente du manifeste bloque même si toutes les autres sont vertes', t => {
  const { root, manifest } = fixture(t)
  manifest.checks.shift()
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, false)
  assert.match(result.errors.join('\n'), /exigence critique absente/)
})

test('fail, blocked et not_executed ne peuvent jamais devenir un verdict prêt', t => {
  for (const [status, exitCode] of [['fail', 1], ['blocked', null], ['not_executed', null]]) {
    const { root, manifest } = fixture(t)
    Object.assign(manifest.checks[0], { status, exitCode })
    const result = evaluateManifest(manifest, root)
    assert.equal(result.ready, false, status)
    assert.equal(result.blocking, 1, status)
  }
})

test('un statut pass avec code non nul ou marqueur absent est invalide', t => {
  {
    const { root, manifest } = fixture(t)
    manifest.checks[0].exitCode = 1
    const result = evaluateManifest(manifest, root)
    assert.equal(result.ready, false)
    assert.match(result.errors.join('\n'), /pass exige exitCode 0/)
  }
  {
    const { root, manifest } = fixture(t)
    manifest.checks[0].passMarker = 'MARQUEUR QUI NE FIGURE PAS DANS LA PREUVE'
    const result = evaluateManifest(manifest, root)
    assert.equal(result.ready, false)
    assert.match(result.errors.join('\n'), /marqueur de réussite absent/)
  }
})

test('une preuve modifiée après le SHA256SUMS invalide le verdict', t => {
  const { root, manifest, evidence } = fixture(t)
  fs.appendFileSync(path.join(evidence, manifest.checks[0].evidence[0]), 'modification après empreinte\n')
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, false)
  assert.match(result.errors.join('\n'), /empreinte de preuve divergente/)
})

test('un chemin de preuve sortant du dossier est refusé', t => {
  const { root, manifest } = fixture(t)
  manifest.checks[0].evidence = ['../secret-en-dehors.txt']
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, false)
  assert.match(result.errors.join('\n'), /chemin de preuve refusé/)
})

test('un identifiant dupliqué est refusé au lieu de masquer une exigence', t => {
  const { root, manifest } = fixture(t)
  manifest.checks.push({ ...manifest.checks[0] })
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, false)
  assert.match(result.errors.join('\n'), /contrôle dupliqué/)
})

test('une ligne SHA256SUMS malformée ou dupliquée est fail-closed', t => {
  const { root, manifest, evidence } = fixture(t)
  fs.appendFileSync(path.join(evidence, 'SHA256SUMS'), 'ligne non conforme\n')
  const result = evaluateManifest(manifest, root)
  assert.equal(result.ready, false)
  assert.match(result.errors.join('\n'), /SHA256SUMS ligne .* invalide/)
})

test('la publication exige la readiness après dist et avant signature', () => {
  const pkg = require('../package.json')
  const command = pkg.scripts['release:publish']
  const dist = command.indexOf('npm run dist')
  const readiness = command.indexOf('npm run readiness:final')
  const sign = command.indexOf('npm run release:sign')
  assert.ok(dist >= 0 && readiness > dist && sign > readiness, command)
})

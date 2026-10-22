'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'final-release-gate.mjs')

/**
 * Exécute une copie instrumentée de la porte, jamais ses commandes réelles.
 * Les imports de spawnSync/existsSync sont remplacés par des stubs locaux :
 * le test mesure uniquement la décision OK/ÉCHEC/NON EXÉCUTÉ, sans DB, réseau,
 * build, secret ni modification du checkout.
 */
function runGate(t, { fast = false, allCriticalPresent = false, devNextOnly = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-release-gate-verdict-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  fs.writeFileSync(path.join(dir, 'stubs.mjs'), `
export function spawnSync() { return { status: 0, stdout: '', stderr: '' } }
export function existsSync(name) {
  if (process.env.GF_TEST_DEV_NEXT_ONLY === '1' && name === '.next/BUILD_ID') return false
  return process.env.GF_TEST_ALL_CRITICAL === '1' || name !== '.env'
}
`)

  let source = fs.readFileSync(GATE, 'utf8')
  const childImport = "import { spawnSync } from 'node:child_process'"
  const fsImport = "import { existsSync } from 'node:fs'"
  const purge = "const { purgerEnvStandalone } = createRequire(import.meta.url)('./lib/purge-standalone-env.cjs')"
  assert.ok(source.includes(childImport), 'import child_process à instrumenter')
  assert.ok(source.includes(fsImport), 'import fs à instrumenter')
  assert.ok(source.includes(purge), 'purge standalone à neutraliser')
  source = source
    .replace(childImport, "import { spawnSync } from './stubs.mjs'")
    .replace(fsImport, "import { existsSync } from './stubs.mjs'")
    .replace(purge, 'const purgerEnvStandalone = () => []')
    .replaceAll('process.exit(1)', 'process.exitCode = 1')

  const copy = path.join(dir, 'gate.mjs')
  fs.writeFileSync(copy, source)
  return spawnSync(process.execPath, [copy, ...(fast ? ['--fast'] : [])], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GF_TEST_ALL_CRITICAL: allCriticalPresent ? '1' : '0',
      GF_TEST_DEV_NEXT_ONLY: devNextOnly ? '1' : '0',
      ...(allCriticalPresent ? {
        TEST_POSTGRES_URL: 'postgresql://invalid-fixture-not-contacted',
        TEST_REDIS_URL: 'invalid-fixture-not-contacted',
      } : {}),
    },
  })
}

test('la porte complète refuse les contrôles critiques NON EXÉCUTÉS même si tout le reste réussit', t => {
  const result = runGate(t)
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(`${result.stdout}\n${result.stderr}`, /NON EXÉCUTÉ.*obligatoire|obligatoire.*NON EXÉCUTÉ/i)
  assert.ok(!result.stdout.includes('GATE PASSÉ'), 'aucun faux vert avec des skips critiques')
})

test('--fast reste un pré-contrôle local et ne revendique jamais une readiness production', t => {
  const result = runGate(t, { fast: true })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /PRÉ-PR|pré-contrôle/i)
  assert.match(result.stdout, /pas|ne constitue pas|jamais/i)
  assert.ok(!result.stdout.includes('GATE PASSÉ'))
})

test('la porte complète reste verte lorsque chaque contrôle critique est exécuté et réussit', t => {
  const result = runGate(t, { allCriticalPresent: true })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.doesNotMatch(result.stdout, /NON EXÉCUTÉ/)
})

test('le budget ne mesure jamais une sortie Next de développement sans BUILD_ID', t => {
  const result = runGate(t, { devNextOnly: true })
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(result.status, 1, output)
  assert.match(output, /Budget de performance[^\n]*NON EXÉCUTÉ/)
  assert.match(output, /BUILD_ID/, 'la raison doit identifier la preuve de build de production absente')
  assert.ok(!result.stdout.includes('GATE PASSÉ'), 'un budget non exécuté reste bloquant en mode complet')
})

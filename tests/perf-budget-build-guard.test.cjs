'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const script = path.resolve('scripts/check-perf-budget.mjs')

function fixture(t, { buildId = null, totalClientJsBytes = 1000, largestChunkBytes = 1000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-perf-guard-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'perf-budget.json'), JSON.stringify({ totalClientJsBytes, largestChunkBytes }))
  fs.mkdirSync(path.join(root, '.next', 'static', 'chunks'), { recursive: true })
  fs.writeFileSync(path.join(root, '.next', 'static', 'chunks', 'main-app.js'), 'x'.repeat(100))
  if (buildId !== null) fs.writeFileSync(path.join(root, '.next', 'BUILD_ID'), buildId)
  return root
}

function run(root) {
  return spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
}

test('performance budget refuses development assets without BUILD_ID before measuring', t => {
  const result = run(fixture(t))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /BUILD_ID/)
  assert.doesNotMatch(result.stdout, /Total JS client/)
})

test('performance budget refuses an empty BUILD_ID', t => {
  const result = run(fixture(t, { buildId: '  \n' }))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /BUILD_ID/)
  assert.doesNotMatch(result.stdout, /Total JS client/)
})

test('performance budget measures a complete production-shaped fixture', t => {
  const result = run(fixture(t, { buildId: 'build-test-123\n' }))
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Total JS client/)
  assert.match(result.stdout, /Budget de performance respecté/)
})

test('performance budget still enforces thresholds after the build guard', t => {
  const result = run(fixture(t, { buildId: 'build-test-123\n', totalClientJsBytes: 50 }))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Total JS client/)
  assert.match(result.stderr, /Budget de performance dépassé/)
})

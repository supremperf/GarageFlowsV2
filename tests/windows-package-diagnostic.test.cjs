'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { inflateSync } = require('node:zlib')
const { redact, exitCode, diagnostic } = require('../scripts/windows-package-diagnostic.cjs')
test('literal environment secrets, private PEM, credentials and signed URLs are withheld', () => {
  const value = 'SYNTHETIC_NOT_A_REAL_SECRET'
  const input = `npm failure ${value}\nhttps://fixture.invalid/a?signature=SYNTHETIC_SIGNED_QUERY\npostgres://user:SYNTHETIC_PASSWORD@fixture/db\n-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_KEY_BODY\n-----END RSA PRIVATE KEY-----\napiKey=SYNTHETIC_LABELED_VALUE`
  const safe = redact(input, { TEST_TOKEN: value })
  for (const forbidden of [value, 'SYNTHETIC_SIGNED_QUERY', 'SYNTHETIC_PASSWORD', 'SYNTHETIC_KEY_BODY', 'SYNTHETIC_LABELED_VALUE']) assert.ok(!safe.includes(forbidden))
  assert.ok(safe.includes('npm failure'))
})
test('exit codes cannot turn a failed, signalled or unspawned packaging command green', () => {
  for (const status of [0, 1, 2, 137]) assert.equal(exitCode({ status }), status)
  assert.equal(exitCode({ status: null, signal: 'SIGTERM' }), 1)
  assert.equal(exitCode({ error: { code: 'ENOENT' } }), 1)
})
test('annotations retain readable build diagnostics and lossless projected metadata', () => {
  const result = diagnostic({ status: 7, stdout: 'Cannot create symbolic link: winCodeSign\nprisma engine resource missing', stderr: 'Build failed\nProperty fixture does not exist' }, {})
  const restored = JSON.parse(inflateSync(Buffer.from(result.pages.map(page => page.payload).join(''), 'base64')))
  assert.deepEqual(restored, result.metadata)
  assert.equal(restored.command, 'npm run dist'); assert.equal(restored.exitCode, 7)
  assert.ok(restored.completeSanitizedLog); assert.match(restored.log, /winCodeSign/)
  assert.match(restored.log, /Property fixture does not exist/)
  assert.ok(result.pages.every(page => JSON.stringify(page).length < 3000))
})
test('large logs are explicitly incomplete, with bounded tails and a full-input digest', () => {
  const result = diagnostic({ status: 1, stdout: 'x'.repeat(25_000), stderr: 'final failure' }, {})
  assert.equal(result.metadata.completeSanitizedLog, false)
  assert.equal(result.metadata.tailCharacters, 10_000)
  assert.match(result.metadata.rawSha256, /^[a-f0-9]{64}$/)
  assert.match(result.metadata.log, /final failure$/)
})
test('secrets are removed before truncation, including incomplete private key blocks', () => {
  const result = diagnostic({ status: 1, stdout: '-----BEGIN PRIVATE KEY-----\n' + 'SYNTHETIC_KEY_BODY'.repeat(1000), stderr: '' }, {})
  assert.ok(!result.metadata.log.includes('SYNTHETIC_KEY_BODY'))
  assert.match(result.metadata.log, /PRIVATE_KEY_REDACTED/)
})

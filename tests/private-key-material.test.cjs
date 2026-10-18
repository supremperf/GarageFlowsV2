'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path')
const { containsPrivateKeyMaterial } = require('../scripts/lib/private-key-material.cjs')
test('multiline P256 and short Ed25519 PKCS8 material are detected in plain and JSON strings', () => {
  for (const options of [{ kind: 'ec', params: { namedCurve: 'prime256v1' } }, { kind: 'ed25519', params: {} }]) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync(options.kind, options.params)
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    assert.equal(containsPrivateKeyMaterial(pem), true)
    assert.equal(containsPrivateKeyMaterial(JSON.stringify({ value: pem })), true)
    assert.equal(containsPrivateKeyMaterial(publicKey.export({ type: 'spki', format: 'pem' })), false)
  }
})
test('encrypted private material is rejected without any passphrase request', () => {
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
  const pem = key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'fixture-only-not-a-production-secret' })
  assert.equal(containsPrivateKeyMaterial(pem), true)
})
test('library header literals are not private keys, and delivery scans cannot skip large files or failed extraction', () => {
  assert.equal(containsPrivateKeyMaterial("const marker = '-----BEGIN PRIVATE KEY-----';"), false)
  const scanner = fs.readFileSync(path.join(__dirname, '../scripts/check-artifact-secrets.mjs'), 'utf8')
  assert.match(scanner, /PRIVATE_BLOCK\.test\(text\) \|\| containsPrivateKeyMaterial\(text\)/)
  assert.match(scanner, /FICHIER NON INSPECTÉ/)
  assert.match(scanner, /while \(\(length = readSync/)
  assert.ok(!scanner.includes('size > 220'))
})

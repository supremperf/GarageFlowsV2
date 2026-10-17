'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const pair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const privatePem = key => key.export({ type: 'pkcs8', format: 'pem' })
const publicPem = key => key.export({ type: 'spki', format: 'pem' })
test('read-only issuer check proves mathematical correspondence for multiple P-256 anchors', async () => {
  const { verifyIssuerCorrespondence } = await import('../scripts/verify-license-issuer.mjs')
  const k = pair()
  const result = verifyIssuerCorrespondence(privatePem(k.privateKey), [publicPem(k.publicKey), publicPem(k.publicKey)])
  assert.equal(result.ok, true)
  assert.equal(result.anchorsChecked, 2)
  assert.match(result.publicFingerprint, /^[a-f0-9]{64}$/)
})
test('any mismatched anchor fails; no majority or first-key-only acceptance', async () => {
  const { verifyIssuerCorrespondence } = await import('../scripts/verify-license-issuer.mjs')
  const k = pair(), other = pair()
  assert.throws(() => verifyIssuerCorrespondence(privatePem(k.privateKey), [publicPem(k.publicKey), publicPem(other.publicKey)]))
  assert.throws(() => verifyIssuerCorrespondence(privatePem(k.privateKey), []))
})
test('non-P256 keys cannot validate issuer correspondence even when matching', async () => {
  const { verifyIssuerCorrespondence } = await import('../scripts/verify-license-issuer.mjs')
  const k = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  assert.throws(() => verifyIssuerCorrespondence(privatePem(k.privateKey), [publicPem(k.publicKey)]))
})
test('CLI missing/foreign private key exits nonzero without key material or crypto stack', () => {
  const env = { ...process.env }; delete env.GF_PRIVATE_KEY
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-issuer-fixture-'))
  const file = path.join(folder, 'fixture.pem')
  try {
    fs.writeFileSync(file, privatePem(pair().privateKey), { mode: 0o600 })
    for (const args of [[], ['--private-key-file', file]]) {
      assert.throws(() => execFileSync(process.execPath, ['scripts/verify-license-issuer.mjs', ...args], { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }), e => e.status === 1 && e.stderr.includes('KEY_CHECK_FAILED') && !/BEGIN| at |openssl/i.test(e.stderr.toString()))
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})

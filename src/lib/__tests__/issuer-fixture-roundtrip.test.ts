import { it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const anchor = vi.hoisted(() => ({ pem: '' }))
vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => anchor.pem }))
import { verifyLicenseToken } from '@/lib/license/verify'
const require = createRequire(import.meta.url)
const { assertLicenseTrust } = require('../../../electron/license-trust.js')
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pem = (key: crypto.KeyObject) => key.export({ type: 'spki', format: 'pem' }).toString()
beforeEach(() => { anchor.pem = pem(pair.publicKey) })
const base = () => ({ lid: crypto.randomUUID(), cid: 'FIXTURE-NOT-ISSUED', typ: 'premium', iss: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, seats: 1, wm: 'fixture', ver: '2.0' })
function mint(payload = base(), key = pair.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `${header}.${body}`
  return `GF2.${input}.${crypto.sign('sha256', Buffer.from(input), key).toString('base64url')}`
}
function electronVerify(token: string) {
  // Execute the actual verifier function, not a reimplementation. No Electron startup.
  const main = fs.readFileSync(path.resolve('electron/main.js'), 'utf8')
  const fn = main.match(/function verifyEccToken\(token\) \{[\s\S]*?\n\}/)?.[0]
  if (!fn) throw new Error('Actual Electron verifier not found')
  const verify = vm.runInNewContext(`${fn}; verifyEccToken`, {
    crypto, Buffer, PUBLIC_KEY_PEM: anchor.pem, assertLicenseTrust,
    b64uDecode: (s: string) => Buffer.from(s, 'base64url'),
    log: () => {}, publicKeyFingerprint: () => 'fixture',
  }, { timeout: 1000 })
  return verify(token)
}
it('P-256 fixture signs a GF2 payload accepted by the actual PWA and Electron verifiers', () => {
  const token = mint()
  expect(verifyLicenseToken(token).valid).toBe(true)
  expect(electronVerify(token)?.cid).toBe('FIXTURE-NOT-ISSUED')
})
it('a different mathematically valid key is not accepted by either verifier', () => {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const token = mint(base(), other.privateKey)
  expect(verifyLicenseToken(token).valid).toBe(false)
  expect(electronVerify(token)).toBeNull()
})
it('changing the payload without re-signing is rejected by both verifiers', () => {
  const parts = mint().split('.')
  parts[2] = Buffer.from(JSON.stringify({ ...base(), seats: 100 })).toString('base64url')
  expect(verifyLicenseToken(parts.join('.')).valid).toBe(false)
  expect(electronVerify(parts.join('.'))).toBeNull()
})
it('a correctly signed but expired fixture is rejected by both verifiers', () => {
  const token = mint({ ...base(), exp: Math.floor(Date.now() / 1000) - 3600 })
  expect(verifyLicenseToken(token).valid).toBe(false)
  expect(electronVerify(token)).toBeNull()
})
it('the actual Python keygen signs a transient fixture accepted by the actual Node verifiers', () => {
  const python = fs.existsSync('.venv/bin/python') ? path.resolve('.venv/bin/python') : 'python3'
  // No private fixture is written or returned; only a test token and PUBLIC key.
  const script = `import sys,json\nsys.path.insert(0, 'scripts')\nimport keygen_core as k\nfrom cryptography.hazmat.primitives.asymmetric import ec\nfrom cryptography.hazmat.primitives import serialization\np=ec.generate_private_key(ec.SECP256R1())\nr=k.make_license(p, 'PYTHON-FIXTURE-NOT-ISSUED', 'premium')\nprint(json.dumps({'token':r['token'],'public':p.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()}))`
  const fixture = JSON.parse(execFileSync(python, ['-c', script], { encoding: 'utf8', timeout: 10000 }))
  anchor.pem = fixture.public
  expect(verifyLicenseToken(fixture.token).valid).toBe(true)
  expect(electronVerify(fixture.token)?.cid).toBe('PYTHON-FIXTURE-NOT-ISSUED')
})

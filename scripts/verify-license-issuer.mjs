#!/usr/bin/env node
// READ ONLY. No license is minted, no DB/HTTP call, no key synchronization.
import { createPrivateKey, createPublicKey, createHash, randomBytes, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const fingerprint = key => createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex')
function assertP256(key) {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('KEY_CHECK_FAILED')
}
export function verifyIssuerCorrespondence(privatePem, publicPems) {
  if (!Array.isArray(publicPems) || publicPems.length < 1) throw new Error('KEY_CHECK_FAILED')
  const issuer = createPrivateKey(privatePem)
  assertP256(issuer)
  const issuerFp = fingerprint(issuer)
  // Domain-separated random challenge, NOT a GF2 token or usable license.
  const challenge = Buffer.concat([Buffer.from('GarageFlows issuer correspondence v1\0'), randomBytes(32)])
  const signature = sign('sha256', challenge, issuer)
  for (const pem of publicPems) {
    const pub = createPublicKey(pem)
    assertP256(pub)
    const fp = createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex')
    if (fp !== issuerFp || !verify('sha256', challenge, pub, signature)) throw new Error('KEY_CHECK_FAILED')
  }
  return { ok: true, publicFingerprint: issuerFp, anchorsChecked: publicPems.length }
}
export function readEmbeddedPublicKey(file, variable) {
  const text = readFileSync(file, 'utf8')
  const block = text.match(new RegExp(`const\\s+${variable}\\s*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!block) throw new Error('KEY_CHECK_FAILED')
  return [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n')
}
function main() {
  try {
    const args = process.argv.slice(2)
    const options = {}
    while (args.length) {
      const key = args.shift()
      if (!['--private-key-file', '--public-key-file'].includes(key) || !args.length || options[key]) throw new Error('KEY_CHECK_FAILED')
      options[key] = args.shift()
    }
    // Same source priority as admin/licenses/generate; forbid accidental override.
    if (process.env.GF_PRIVATE_KEY && options['--private-key-file']) throw new Error('KEY_CHECK_FAILED')
    const pem = process.env.GF_PRIVATE_KEY
      ? Buffer.from(process.env.GF_PRIVATE_KEY, 'base64').toString('utf8')
      : options['--private-key-file'] ? readFileSync(options['--private-key-file'], 'utf8') : null
    if (!pem) throw new Error('KEY_CHECK_FAILED')
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const anchors = [
      readEmbeddedPublicKey(path.join(root, 'src/lib/license/public-key.ts'), '_LINES'),
      readEmbeddedPublicKey(path.join(root, 'electron/main.js'), '_PK'),
    ]
    if (options['--public-key-file']) anchors.push(readFileSync(options['--public-key-file'], 'utf8'))
    console.log(JSON.stringify(verifyIssuerCorrespondence(pem, anchors)))
  } catch {
    // Never print crypto errors, PEMs, signatures, environment or paths.
    console.error('KEY_CHECK_FAILED: issuer missing, invalid, conflicting, or not matching every supplied P-256 anchor. No key or database changed.')
    process.exitCode = 1
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

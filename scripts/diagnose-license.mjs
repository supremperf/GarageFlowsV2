#!/usr/bin/env node
// Offline, read-only support tool. Never emits token, payload, private key or raw crypto errors.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

/** Compile the actual repository verifier and its two actual local dependencies.
 * No verifier/crypto reimplementation. Never evaluates input tokens as source.
 * Intended for a trusted source checkout, not for executing untrusted repositories.
 */
export function sourceVerifier(root = ROOT, publicKeyPem) {
  const cache = new Map()
  const allowed = new Map([
    ['./public-key', 'src/lib/license/public-key.ts'],
    ['./failures', 'src/lib/license/failures.ts'],
  ])
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText
    const exports = {}
    cache.set(file, exports)
    const require = name => {
      if (name === 'crypto' || name === 'node:crypto') return crypto
      if (name === './public-key' && publicKeyPem !== undefined) return { getPublicKeyPem: () => publicKeyPem }
      if (allowed.has(name)) return load(allowed.get(name))
      throw new Error('UNSUPPORTED_VERIFIER_DEPENDENCY')
    }
    vm.runInNewContext(js, { exports, require, Buffer, Set, Date,
      process: { env: { NODE_ENV: 'production' } } }, { filename: file, timeout: 2000 })
    return exports
  }
  const { getPublicKeyPem } = publicKeyPem === undefined ? load('src/lib/license/public-key.ts') : { getPublicKeyPem: () => publicKeyPem }
  const publicKey = crypto.createPublicKey(getPublicKeyPem())
  const publicFingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }))
  return { verify: load('src/lib/license/verify.ts').verifyLicenseToken, publicFingerprint,
    verifierSourceSha256: hash(fs.readFileSync(path.join(root, 'src/lib/license/verify.ts'))) }
}

export function diagnoseToken(token, options = {}) {
  let code
  const base = { scope: options.publicKeyPem === undefined ? 'LOCAL_SOURCE_ONLY' : 'OPERATOR_SUPPLIED_PUBLIC_ANCHOR_ONLY',
    deployedRuntimeVerified: false, tokenSha256: hash(token) }
  try {
    const { verify, ...identity } = sourceVerifier(options.root, options.publicKeyPem)
    Object.assign(base, identity)
    const result = verify(token, stage => { code = stage })
    return { ...base, ok: result.valid, code: result.valid ? 'VERIFIED' : code ?? 'UNKNOWN_REJECTION' }
  } catch {
    return { ...base, ok: false, code: code ?? 'DIAGNOSTIC_OR_ANCHOR_UNAVAILABLE' }
  }
}

function main() {
  try {
    const args = process.argv.slice(2), options = {}
    while (args.length) {
      const flag = args.shift()
      if (flag === '--print-public-fingerprint' && !options[flag]) { options[flag] = true; continue }
      if (!['--token-file', '--public-key-file'].includes(flag) || !args.length || options[flag]) throw new Error()
      options[flag] = args.shift()
    }
    const publicKeyPem = options['--public-key-file'] ? fs.readFileSync(options['--public-key-file'], 'utf8') : undefined
    if (options['--print-public-fingerprint'] && !options['--token-file']) {
      const { publicFingerprint, verifierSourceSha256 } = sourceVerifier(ROOT, publicKeyPem)
      console.log(JSON.stringify({ ok: true, publicFingerprint, verifierSourceSha256, deployedRuntimeVerified: false }))
      return
    }
    if (!options['--token-file']) throw new Error()
    const token = fs.readFileSync(options['--token-file'], 'utf8').trim()
    const report = diagnoseToken(token, { publicKeyPem })
    console.log(JSON.stringify(report))
    if (!report.ok) process.exitCode = 1
  } catch {
    console.error(JSON.stringify({ ok: false, code: 'DIAGNOSTIC_INPUT_UNAVAILABLE', hint: 'Use --token-file (local protected file) or --print-public-fingerprint. No key or token is printed.' }))
    process.exitCode = 1
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

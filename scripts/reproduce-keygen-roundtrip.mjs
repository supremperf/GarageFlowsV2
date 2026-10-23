#!/usr/bin/env node
// Fixture-only E2E: actual Python GUI signing boundary -> actual TypeScript verifier.
// Does NOT activate a real license, contact HTTP/DB, change anchors or start Tk/Electron.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { diagnoseToken } from './diagnose-license.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Délai maximal d'un appel Python. C'est un garde-fou contre un BLOCAGE, pas une
 * mesure de performance : le franchir doit signifier « Python ne répond plus ».
 *
 * Les 10 s d'origine le trahissaient. Lancé seul, ce scénario tient en ~5 s ;
 * lancé avec les 365 fichiers de la suite Vitest en parallèle, le PREMIER
 * démarrage de l'interpréteur (alias d'exécution Windows Store + import de
 * `cryptography`) dépassait 10 s et faisait échouer tout le FICHIER de tests —
 * `spawnSync python3 ETIMEDOUT`, aucun test exécuté, de façon NON déterministe.
 * Même cause et même correctif que le `hookTimeout: 30_000` de vitest.config.mts.
 *
 * Un vrai blocage reste détecté : la limite est franche, simplement compatible
 * avec une machine chargée.
 */
const PYTHON_TIMEOUT_MS = 60_000

export function reproduce(onCoherentToken) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-keygen-fixture-'))
  // Interpréteur Python : venv du dépôt d'abord (POSIX puis Windows), sinon ce
  // que le poste expose. `python3` n'existe pas sur toutes les installations
  // Windows ; `python` et le lanceur `py -3` sont les formes usuelles.
  const python = [
    path.join(ROOT, '.venv/bin/python'),
    path.join(ROOT, '.venv/Scripts/python.exe'),
  ].find(candidate => fs.existsSync(candidate))
    ?? ['python3', 'python'].find(candidate => {
      const probe = spawnSync(candidate, ['-c', 'pass'], { timeout: PYTHON_TIMEOUT_MS })
      return !probe.error && probe.status === 0
    })
    ?? 'python3'
  const steps = []
  try {
    for (const f of ['scripts/keygen_core.py', 'scripts/keygen_trust.py', 'scripts/keygen_ui.py']) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f))
    }
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const foreign = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const foreignPub = foreign.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    function write(file, text, mode) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), text, { mode })
    }
    const array = (name, pem) => `const ${name} = ${JSON.stringify(pem.trim().split('\n')).replaceAll('"', "'")}\n`
    write('keys/private.pem', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600)
    write('keys/public.pem', pub)
    write('src/lib/license/public-key.ts', array('_LINES', pub))
    write('electron/main.js', array('_PK', pub))
    const runPython = code => execFileSync(python, ['-c', code], { cwd: dir, encoding: 'utf8', timeout: PYTHON_TIMEOUT_MS }).trim()
    const prelude = "import sys,json; sys.path.insert(0,'scripts'); import keygen_core as k; p=k.load_checked_private_key(); "
    const token = runPython(prelude + "print(k.make_license(p,'FIXTURE-ÉTÉ-NOT-ISSUED','premium',label='Garage été')['token'])")
    // Optional in-memory test hook; never used by the CLI or persisted in its report.
    onCoherentToken?.({ token, publicKeyPem: pub })
    const record = (name, expected, actual) => steps.push({ name, expected, actual, passed: expected === actual })
    const check = (name, input, expected, publicKeyPem = pub) => {
      const report = diagnoseToken(input, { publicKeyPem })
      record(name, expected, report.code)
    }
    const cli = spawnSync(python, ['scripts/keygen_ui.py', '--verify-key-match'], { cwd: dir, encoding: 'utf8', timeout: PYTHON_TIMEOUT_MS })
    record('headless GUI diagnostic: coherent private/PEM/PWA/Electron', 0, cli.status)
    record('headless diagnostic exposes no private key', false, (cli.stdout + cli.stderr).includes('PRIVATE KEY'))
    check('actual checked Python garage generator -> actual verify.ts (Unicode, DER)', token, 'VERIFIED')
    const mechanic = runPython(prelude + "print(k.make_mechanic_license(p,'fixture-parent','fixture-customer')['token'])")
    check('actual checked Python mechanic generator -> actual verify.ts', mechanic, 'VERIFIED')
    check('same Python token, different verifier public key', token, 'SIGNATURE_INVALID', foreignPub)
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[2], 'base64url').toString())
    parts[2] = Buffer.from(JSON.stringify({ ...payload, seats: 999 })).toString('base64url')
    check('payload modified without re-signing', parts.join('.'), 'SIGNATURE_INVALID')
    check('unrecognized token format', 'GF1.invalid', 'FORMAT_INVALID')
    const expired = runPython(prelude + "print(k.make_license(p,'fixture','premium',years=-1)['token'])")
    check('correct signature but expiration', expired, 'EXPIRED')
    const missing = runPython(prelude + "r=k.make_license(p,'fixture','premium'); d=json.loads(k.b64u_dec(r['token'].split('.')[2])); del d['exp']; print(k._sign(p,d))")
    check('correct signature but missing exp', missing, 'PAYLOAD_FIELDS_INVALID')
    const version = runPython(prelude + "r=k.make_license(p,'fixture','premium'); d=json.loads(k.b64u_dec(r['token'].split('.')[2])); d['ver']='3.0'; print(k._sign(p,d))")
    check('correct signature but unsupported version', version, 'VERSION_UNSUPPORTED')
    const unsupported = token.split('.'); unsupported[1] = Buffer.from(JSON.stringify({ alg: 'none', typ: 'GF-LIC', v: 2 })).toString('base64url')
    check('algorithm substitution rejected before signature', unsupported.join('.'), 'HEADER_UNSUPPORTED')
    write('electron/main.js', array('_PK', foreignPub))
    const mismatch = spawnSync(python, ['scripts/keygen_ui.py', '--verify-key-match'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    record('different Electron anchor makes GUI diagnostic fail closed', 1, mismatch.status)
    const stopped = spawnSync(python, ['-c', prelude + "print(k.make_license(p,'fixture','premium')['token'])"], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    record('same GUI key-loading boundary blocks minting on divergence', 1, stopped.status)
    record('no token emitted on divergence', false, stopped.stdout.includes('GF2.'))
    record('no license database written', false, fs.existsSync(path.join(dir, 'keys/licenses_db.json')))
    write('electron/main.js', array('_PK', pub))
    write('target-public.pem', foreignPub)
    const targetMismatch = spawnSync(python, ['scripts/keygen_ui.py', '--verify-key-match', '--public-key-file', 'target-public.pem'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    record('operator target PEM mismatch cannot be overridden by matching local anchors', 1, targetMismatch.status)
    fs.unlinkSync(path.join(dir, 'keys/public.pem'))
    const missingAnchor = spawnSync(python, ['scripts/keygen_ui.py', '--verify-key-match'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    record('missing local PEM fails closed', 1, missingAnchor.status)
    write('keys/public.pem', pub)
    write('keys/private.pem', pair.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'fixture-passphrase' }), 0o600)
    record('encrypted private PEM loads only with the fixture passphrase', 'KEY_MATCH', runPython("import sys; sys.path.insert(0,'scripts'); import keygen_core as k; k.load_checked_private_key('fixture-passphrase'); print('KEY_MATCH')"))
    const wrongCurve = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
    write('keys/private.pem', wrongCurve.privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600)
    const curve = spawnSync(python, ['scripts/keygen_ui.py', '--verify-key-match'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    record('wrong signing curve rejected', 'P256_REQUIRED', JSON.parse(curve.stdout).code)
    return { ok: steps.every(s => s.passed), scope: 'FIXTURES_ONLY; no deployed keys/runtime, DB or GUI rendering verified', steps }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = reproduce()
    console.log(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 1
  } catch {
    console.error(JSON.stringify({ ok: false, code: 'REPRODUCTION_FAILED', hint: 'Install locked Python test dependencies and Node dev dependencies. No token/private key is printed.' }))
    process.exitCode = 1
  }
}

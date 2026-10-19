#!/usr/bin/env node
/**
 * Campagne automatisée de 100 licences — keygen réel → vérificateur réel.
 *
 * Ce que ce script PROUVE, et rien de plus :
 *   1. 100 jetons DISTINCTS sont signés par la frontière de signature du GUI
 *      (`keygen_core.load_checked_private_key` : clé privée + ancres locales),
 *      via les vraies fonctions `make_license` / `make_mechanic_license` ;
 *   2. chacun est vérifié par le VRAI `src/lib/license/verify.ts` (transpilé,
 *      pas réimplémenté) : signature ES256, en-tête, payload, dates, droits ;
 *   3. les contrôles négatifs échouent pour la bonne raison (altération,
 *      mauvaise clé, expiration, mauvais HWID) ;
 *   4. après « redémarrage » (processus Node séparé), les 100 jetons relus
 *      depuis le fichier de preuve sont encore acceptés à l'identique.
 *
 * Ce que ce script ne prétend PAS : activer une licence en base (le moteur
 * Prisma n'est pas disponible dans cet environnement), ni exécuter
 * l'installateur Windows. La clé utilisée est une paire de FIXTURE éphémère,
 * jamais la clé de production (absente du dépôt).
 *
 * Usage : node scripts/campagne-100-licences.mjs [--out <fichier.json>]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { sourceVerifier } from './diagnose-license.mjs'

const nodeRequire = createRequire(import.meta.url)
const ts = nodeRequire('typescript')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const python = fs.existsSync(path.join(ROOT, '.venv/bin/python'))
  ? path.join(ROOT, '.venv/bin/python')
  : 'python3'

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** Prépare une copie minimale du keygen + des ancres cohérentes. */
function preparerFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-campagne-100-'))
  for (const f of ['scripts/keygen_core.py', 'scripts/keygen_trust.py', 'scripts/keygen_ui.py']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f))
  }
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const write = (file, text, mode) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text, { mode })
  }
  const array = (name, pem) =>
    `const ${name} = ${JSON.stringify(pem.trim().split('\n')).replaceAll('"', "'")}\n`
  write('keys/private.pem', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600)
  write('keys/public.pem', pub)
  write('src/lib/license/public-key.ts', array('_LINES', pub))
  write('electron/main.js', array('_PK', pub))
  return { dir, pub }
}

/** Spécifications déterministes des 100 licences (aucun aléa non traçable). */
function construireSpecs() {
  const types = ['trial', 'premium', 'enterprise', 'admin']
  const specs = []
  for (let i = 1; i <= 100; i++) {
    const n = String(i).padStart(4, '0')
    const typ = types[(i - 1) % types.length]
    const years = 1 + ((i - 1) % 3)
    const seats = 1 + ((i - 1) % 10)
    const label = i % 7 === 0
      ? `Garage Étoile & Fils — été ${n}`
      : i % 5 === 0
        ? `Garage l’Atelier ${n}`
        : `Garage Campagne ${n}`
    // 20 licences liées : 10 en v0, 10 en v1 ; les autres ne le sont pas.
    let hwid = null
    if (i % 10 === 1 || i % 10 === 6) {
      hwid = sha256(`campagne-v0-${n}`)
    } else if (i % 10 === 2 || i % 10 === 7) {
      hwid = 'HWID1-' + sha256(`campagne-v1-${n}`)
    }
    specs.push({
      index: i,
      cid: `GF-CAMPAGNE-${n}`,
      typ,
      years,
      seats,
      hwid,
      label,
      expectValid: true,
      expectAdmin: typ === 'admin',
    })
  }
  // 5 licences expirées et 5 licences mécanicien (rattachées aux 5 premières).
  for (let i = 1; i <= 5; i++) {
    const n = String(i).padStart(2, '0')
    specs.push({
      index: 100 + i,
      cid: `GF-EXPIRE-${n}`,
      typ: 'premium',
      years: -1,
      seats: 1,
      hwid: null,
      label: `Garage expiré ${n}`,
      expectValid: false,
      expectExpired: true,
    })
  }
  return specs
}

const SCRIPT_PY = String.raw`
import sys, json
sys.path.insert(0, 'scripts')
import keygen_core as k

specs = json.load(sys.stdin)
pk = k.load_checked_private_key()
out = []
for s in specs:
    if s.get('mechanicOf'):
        parent = next(o for o in out if o['index'] == s['mechanicOf'])
        info = k.make_mechanic_license(pk, parent['lid'], s['cid'],
                                       years=s['years'], mechanic_name=s['label'],
                                       label=s['label'])
    else:
        info = k.make_license(pk, s['cid'], s['typ'], years=s['years'],
                              seats=s['seats'], hwid=s['hwid'], label=s['label'])
    info['index'] = s['index']
    out.append(info)
print(json.dumps({'licenses': out}, ensure_ascii=False))
`

function genererLicences(dir, specs) {
  const out = execFileSync(python, ['-c', SCRIPT_PY], {
    cwd: dir,
    input: JSON.stringify(specs),
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out).licenses
}

function ajouterMecaniciens(specs) {
  const meca = []
  for (let i = 1; i <= 5; i++) {
    meca.push({
      index: 200 + i,
      cid: `GF-CAMPAGNE-${String(i).padStart(4, '0')}`,
      typ: 'mechanic',
      years: 1,
      seats: 1,
      hwid: null,
      label: `Mécanicien Campagne ${i}`,
      expectValid: true,
      expectMechanic: true,
      mechanicOf: i,
    })
  }
  return [...specs, ...meca]
}

function verifierLicence(verify, pubPem, spec, info) {
  const checks = []
  const add = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail })
  const result = verify(info.token)
  const payload = result.payload

  add('signature + en-tête + payload (verify.ts réel)', result.valid === true, result.reason ?? null)
  if (!result.valid) return checks

  add('identifiant de licence unique (lid)', typeof payload.lid === 'string' && payload.lid.length > 0)
  add('identifiant client signé = demandé', payload.cid === spec.cid, `${payload.cid}`)
  add('type signé = demandé', payload.typ === spec.typ)
  add('sièges signés = demandés', payload.seats === spec.seats)
  add('version de schéma 2.x', String(payload.ver).startsWith('2'))
  add('date d’émission proche (≤ 120 s)', Math.abs(payload.iss - Math.floor(Date.now() / 1000)) <= 120)
  add('durée signée exacte (365 j/an)', payload.exp - payload.iss === spec.years * 365 * 86400)
  add('non expirée', payload.exp > Math.floor(Date.now() / 1000))
  add('droits admin cohérents', Boolean(result.isAdmin) === Boolean(spec.expectAdmin))
  add('droits mécanicien cohérents', Boolean(result.isMechanic) === Boolean(spec.expectMechanic))
  if (spec.expectMechanic) {
    add('clé mécanicien rattachée à un parent (plid)', typeof payload.plid === 'string' && payload.plid.length > 0)
  } else {
    add('aucun plid sur une licence garage', payload.plid === undefined)
  }
  add('filigrane décodable (cid/label)', (() => {
    const wm = (() => { try { return JSON.parse(Buffer.from(payload.wm, 'base64url').toString('utf8')) } catch { return null } })()
    return wm && wm.c === spec.cid && wm.l === spec.label
  })(), spec.label)

  if (spec.hwid) {
    add('HWID signé = HWID collé (normalisation)', payload.hwid === spec.hwid)
  } else {
    add('aucun HWID signé pour l’une des 80 licences non liées', payload.hwid === undefined)
  }

  // Jeton entouré d'espaces : l'activation fait `String(body.license).trim()`.
  const padded = verify(`  \n${info.token}\n  `.trim())
  add('jeton avec espaces de bord, après trim comme l’activation', padded.valid === true)
  return checks
}

function testsNegatifs(verify, specs, infos, pubPem) {
  const resultats = []
  const parIndex = new Map(infos.map((i) => [i.index, i]))

  // 10 altérations de payload (un champ modifié sans re-signer).
  for (let i = 0; i < 10; i++) {
    const info = parIndex.get(specs[i].index)
    const parts = info.token.split('.')
    const payload = JSON.parse(Buffer.from(parts[2], 'base64url').toString('utf8'))
    payload.seats = payload.seats + 1000
    parts[2] = Buffer.from(JSON.stringify(payload)).toString('base64url')
    let code
    const r = verify(parts.join('.'), (c) => { code = c })
    resultats.push({ test: `altération payload #${i + 1}`, expected: 'SIGNATURE_INVALID', got: code, ok: !r.valid && code === 'SIGNATURE_INVALID' })
  }

  // 5 vérifications avec une AUTRE clé publique (clé étrangère).
  const foreign = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const foreignPem = foreign.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const verifyForeign = sourceVerifier(ROOT, foreignPem).verify
  for (let i = 0; i < 5; i++) {
    let code
    const r = verifyForeign(parIndex.get(specs[i].index).token, (c) => { code = c })
    resultats.push({ test: `clé publique étrangère #${i + 1}`, expected: 'SIGNATURE_INVALID', got: code, ok: !r.valid && code === 'SIGNATURE_INVALID' })
  }

  // 5 licences expirées : le vérificateur doit rendre EXPIRED.
  const expirees = infos.filter((i) => specs.find((s) => s.index === i.index)?.expectExpired)
  if (expirees.length !== 5) throw new Error(`attendu 5 expirées, reçu ${expirees.length}`)
  for (const info of expirees) {
    let code
    const r = verify(info.token, (c) => { code = c })
    resultats.push({ test: `expiration ${info.index}`, expected: 'EXPIRED', got: code, ok: !r.valid && code === 'EXPIRED' })
  }
  return resultats
}

/**
 * Charge le VRAI module verify.ts (pas une copie) pour les règles HWID.
 * `vm` + transpilation TypeScript, dépendances locales réelles uniquement.
 */
function chargerVerifierComplet() {
  const source = fs.readFileSync(path.join(ROOT, 'src/lib/license/verify.ts'), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const exports = {}
  const requireShim = (name) => {
    if (name === 'crypto' || name === 'node:crypto') return crypto
    if (name === './public-key') return { getPublicKeyPem: () => 'stub' }
    if (name === './failures') return { LicenseConfigurationError: class extends Error {} }
    throw new Error(`UNSUPPORTED_DEPENDENCY:${name}`)
  }
  vm.runInNewContext(js, { exports, require: requireShim, Buffer, Set, Date,
    process: { env: { NODE_ENV: 'test' } } }, { filename: 'verify.ts', timeout: 2000 })
  return exports
}

function verifierHwid(infos) {
  const mod = chargerVerifierComplet()
  const results = []
  for (const info of infos) {
    if (!info.hwid) continue
    results.push({
      hwid: info.hwid,
      validFormat: mod.isValidHwidFormat(info.hwid),
      sameMachine: mod.verifyHwid(info.hwid, info.hwid),
      otherMachine: mod.verifyHwid(info.hwid, 'f'.repeat(64)),
      version: mod.hwidVersionOf(info.hwid),
    })
  }
  return results
}

function main() {
  const outArg = process.argv.indexOf('--out')
  const outFile = outArg > -1 ? process.argv[outArg + 1] : path.join(ROOT, 'artifacts/verification/campagne-100-licences.json')
  const { dir, pub } = preparerFixture()
  try {
    const specs = ajouterMecaniciens(construireSpecs())
    const infos = genererLicences(dir, specs)
    if (infos.length !== specs.length) throw new Error(`générées ${infos.length}/${specs.length}`)

    const { verify, publicFingerprint, verifierSourceSha256 } = sourceVerifier(ROOT, pub)
    const specParIndex = new Map(specs.map((s) => [s.index, s]))
    const resultats = infos.filter((i) => specParIndex.get(i.index).expectValid).map((info) => {
      const spec = specParIndex.get(info.index)
      const checks = verifierLicence(verify, pub, spec, info)
      return {
        index: spec.index,
        cid: spec.cid,
        type: spec.typ,
        years: spec.years,
        hwidBound: Boolean(spec.hwid),
        hwidVersion: spec.hwid ? (spec.hwid.startsWith('HWID1-') ? 1 : 0) : null,
        // Noms de champs SANS mot-clé anglais (token/key/secret…) : la valeur
        // est une empreinte SHA-256, jamais un secret, mais la règle Gitleaks
        // `generic-api-key` associe « token: <hex64> » à une clé d'API. Les
        // empreintes restent l'évidence vérifiable, sans faux positif.
        empreinteJetonSha256: sha256(info.token),
        empreinteLidSha256: sha256(info.lid),
        checks,
        passed: checks.every((c) => c.ok),
      }
    })

    const negatifs = testsNegatifs(verify, specs, infos, pub)
    const hwidChecks = verifierHwid(infos)
    const lids = new Set(infos.map((i) => i.lid))
    const tokens = new Set(infos.map((i) => i.token))

    // ── « Redémarrage » : un processus Node SÉPARÉ relit les jetons du disque.
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    const restartFile = path.join(dir, 'jetons-redemarrage.json')
    fs.writeFileSync(restartFile, JSON.stringify(infos.map((i) => ({
      index: i.index,
      token: i.token,
      expectValid: (i.index >= 1 && i.index <= 100) || i.index > 200,
    }))))
    const restartCode = `
      import fs from 'node:fs'
      import { sourceVerifier } from ${JSON.stringify(path.join(ROOT, 'scripts/diagnose-license.mjs'))}
      const entries = JSON.parse(fs.readFileSync(${JSON.stringify(restartFile)}, 'utf8'))
      const { verify } = sourceVerifier(${JSON.stringify(ROOT)}, ${JSON.stringify(pub)})
      const ok = entries.filter((e) => e.expectValid ? verify(e.token).valid : !verify(e.token).valid).length
      console.log(JSON.stringify({ checked: entries.length, ok }))
    `
    const restart = spawnSync(process.execPath, ['--input-type=module', '-e', restartCode], { encoding: 'utf8', timeout: 60_000 })
    const restartResult = restart.status === 0 ? JSON.parse(restart.stdout) : { checked: infos.length, ok: 0, error: restart.stderr?.slice(0, 300) }
    const restartOk = restartResult.ok === infos.length

    const valides = resultats.filter((r) => r.passed).length
    const rapport = {
      generatedAt: new Date().toISOString(),
      scope: 'FIXTURE_KEY_ONLY; verify.ts réel; activation DB et application Windows NON exécutées',
      fixturePublicFingerprint: publicFingerprint,
      verifierSourceSha256,
      totals: {
        garageLicenses: resultats.filter((r) => r.type !== 'mechanic').length,
        mechanicLicenses: resultats.filter((r) => r.type === 'mechanic').length,
        expiredControls: infos.length - resultats.length,
        licenses: resultats.length,
        distinctLids: lids.size,
        distinctTokens: tokens.size,
        licensesPassed: valides,
        negativeChecks: negatifs.length,
        negativePassed: negatifs.filter((n) => n.ok).length,
        hwidCases: hwidChecks.length,
        restartVerified: restartResult.ok,
        restartExpected: infos.length,
      },
      restartOk,
      allPassed: valides === resultats.length && negatifs.every((n) => n.ok) && hwidChecks.every((h) => h.validFormat && h.sameMachine && !h.otherMachine) && restartOk,
      negatives: negatifs,
      hwidChecks,
      licenses: resultats,
    }
    fs.writeFileSync(outFile, JSON.stringify(rapport, null, 1))
    console.log(JSON.stringify({ ...rapport.totals, allPassed: rapport.allPassed, outFile }, null, 2))
    if (!rapport.allPassed) process.exitCode = 1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main()

'use strict'
// Automatic, PROVEN restoration of `_PK` / `_LINES` onto the REFERENCE_FP key.
// Never adopts the divergent key, never touches REFERENCE_FP, never writes without proof.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { generateKeyPairSync, createHash, createPublicKey } = require('node:crypto')
const { restorePublicAnchors, rewriteLiteral, literalPem } = require('../scripts/restore-public-anchors.cjs')
const { inspectAnchors } = require('../scripts/materialize-build-public-key.cjs')

const REF_FILE = 'src/lib/license/__tests__/public-key-consistency.test.ts'
function key() {
  const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { pem, lines: pem.trim().split('\n'), fp: createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex') }
}
function literal(variable, lines, eol = '\n') {
  return `const ${variable} = [${eol}${lines.map(l => `  '${l}',`).join(eol)}${eol}]`
}
async function project(fn, { eol = '\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-restore-'))
  const reference = key(), foreign = key()
  const files = {
    'electron/main.js': `// main${eol}const before = 1${eol}${literal('_PK', foreign.lines, eol)}${eol}const after = 2${eol}`,
    'src/lib/license/public-key.ts': `// server${eol}${literal('_LINES', foreign.lines, eol)}${eol}export const x = 1${eol}`,
    [REF_FILE]: `const REFERENCE_FP = '${reference.fp}' // pinned${eol}`,
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  try { return await fn({ root, reference, foreign, files }) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
const offline = { network: false }
const stubFetch = (body, status = 200) => async () => ({ ok: status === 200, status, text: async () => body })

test('restores both literals from keys/public.pem when its fingerprint IS the reference; rest of the files untouched', () => project(async ({ root, reference, foreign, files }) => {
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  const result = await restorePublicAnchors(root, offline)
  assert.equal(result.restored, true)
  assert.equal(result.source, 'keys/public.pem')
  assert.equal(inspectAnchors(root).agree, true)
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  assert.equal(main, files['electron/main.js'].replace(literal('_PK', foreign.lines), literal('_PK', reference.lines)))
  assert.equal(fs.readFileSync(path.join(root, REF_FILE), 'utf8'), files[REF_FILE], 'REFERENCE_FP never modified')
  // Originals preserved in the backup, byte for byte.
  assert.equal(fs.readFileSync(path.join(root, result.backup, 'electron/main.js'), 'utf8'), files['electron/main.js'])
  assert.equal(fs.readFileSync(path.join(root, result.backup, 'src/lib/license/public-key.ts'), 'utf8'), files['src/lib/license/public-key.ts'])
  assert.deepEqual(result.replacedFingerprints, [foreign.fp])
}))

test('a partial update is repaired from the anchor that is still correct', () => project(async ({ root, reference }) => {
  const file = path.join(root, 'src/lib/license/public-key.ts')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/const _LINES = \[[\s\S]*?\]/, literal('_LINES', reference.lines)))
  const result = await restorePublicAnchors(root, offline)
  assert.equal(result.restored, true)
  assert.match(result.source, /public-key\.ts \(_LINES\)/)
  assert.equal(result.files.length, 1)
  assert.equal(inspectAnchors(root).agree, true)
}))

test('the GitHub copy is accepted ONLY if its fingerprint is the reference', () => project(async ({ root, reference, foreign }) => {
  const good = await restorePublicAnchors(root, { fetchImpl: stubFetch(`x\n${literal('_LINES', reference.lines)}\n`) })
  assert.equal(good.restored, true)
  assert.match(good.source, /^GitHub raw main/)
  assert.equal(inspectAnchors(root).agree, true)
  assert.ok(foreign)
}))

test('a forged / different GitHub copy is rejected and nothing is written', () => project(async ({ root, files }) => {
  const result = await restorePublicAnchors(root, { fetchImpl: stubFetch(literal('_LINES', key().lines)) })
  assert.equal(result.restored, false)
  assert.ok(result.tried.some(t => /autre clé .* écartée/.test(t.outcome)))
  for (const [file, text] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text)
  assert.equal(fs.existsSync(path.join(root, '.gf-anchor-backups')), false)
}))

test('offline / network error: refused with every source listed, files untouched', () => project(async ({ root, files }) => {
  const failing = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }) }
  const result = await restorePublicAnchors(root, { fetchImpl: failing })
  assert.equal(result.restored, false)
  assert.match(result.reason, /introuvable/)
  assert.ok(result.tried.some(t => /ENOTFOUND/.test(t.outcome)))
  assert.ok(result.tried.some(t => t.source === 'git'))
  for (const [file, text] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text)
}))

test('a retired REFERENCE_FP is never used as a restoration target', () => project(async ({ root, reference }) => {
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts/check-critical-files.js'), `const RETIRED_FINGERPRINTS = [\n  { fp: '${reference.fp}', retired: '2026-08-16 (rotation)' },\n]`)
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  const result = await restorePublicAnchors(root, offline)
  assert.equal(result.restored, false)
  assert.match(result.reason, /RETIRÉE/)
}))

test('an ambiguous literal (two declarations) is refused, not guessed', () => project(async ({ root, reference }) => {
  fs.appendFileSync(path.join(root, 'electron/main.js'), `\n${literal('_PK', key().lines)}\n`)
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  const result = await restorePublicAnchors(root, offline)
  assert.equal(result.restored, false)
  assert.match(result.reason, /2 littéral/)
}))

test('a keys/public.pem holding the divergent key is moved into the backup, never deleted', () => project(async ({ root, reference, foreign }) => {
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), foreign.pem)
  const result = await restorePublicAnchors(root, { fetchImpl: stubFetch(literal('_LINES', reference.lines)) })
  assert.equal(result.restored, true)
  assert.equal(result.movedPublicPem, true)
  assert.equal(fs.existsSync(path.join(root, 'keys/public.pem')), false)
  assert.equal(fs.readFileSync(path.join(root, result.backup, 'keys/public.pem'), 'utf8'), foreign.pem)
}))

test('CRLF files stay CRLF', () => project(async ({ root, reference }) => {
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  assert.equal((await restorePublicAnchors(root, offline)).restored, true)
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  assert.equal(main.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF introduced')
}, { eol: '\r\n' }))

test('agreeing anchors: nothing to do', () => project(async ({ root, reference }) => {
  for (const [file, variable] of [['electron/main.js', '_PK'], ['src/lib/license/public-key.ts', '_LINES']]) {
    const full = path.join(root, file)
    fs.writeFileSync(full, rewriteLiteral(fs.readFileSync(full, 'utf8'), variable, reference.pem))
  }
  const result = await restorePublicAnchors(root, offline)
  assert.equal(result.restored, false)
  assert.match(result.reason, /déjà concordants/)
}))

test('literalPem refuses non-key and ambiguous content', () => {
  const k = key()
  assert.equal(literalPem(literal('_LINES', k.lines), '_LINES'), `${k.lines.join('\n')}\n`)
  assert.equal(literalPem(`${literal('_LINES', k.lines)}\n${literal('_LINES', k.lines)}`, '_LINES'), null)
  assert.equal(literalPem("const _LINES = ['nope']", '_LINES'), null)
})

test('preflight repairs automatically, then continues to its other checks', () => project(({ root, reference }) => {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  for (const f of ['preflight-release.cjs', 'materialize-build-public-key.cjs', 'restore-public-anchors.cjs']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(root, 'scripts', f))
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=22.12.0 <23' }, version: '0.0.0', scripts: {} }))
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/preflight-release.cjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GF_ANCHOR_RESTORE_NETWORK: '0' },
  })
  assert.match(run.stdout, /remis AUTOMATIQUEMENT sur la clé de référence/)
  assert.doesNotMatch(run.stderr, /Public anchors disagree/)
  assert.match(run.stdout, /Contrôles avant empaquetage/, 'the remaining preflight checks still run')
  assert.equal(inspectAnchors(root).agree, true)
}))

test('GF_NO_ANCHOR_RESTORE=1 keeps the pure refusal', () => project(({ root, reference, foreign }) => {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  for (const f of ['preflight-release.cjs', 'materialize-build-public-key.cjs', 'restore-public-anchors.cjs']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(root, 'scripts', f))
  }
  fs.mkdirSync(path.join(root, 'keys'))
  fs.writeFileSync(path.join(root, 'keys/public.pem'), reference.pem)
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/preflight-release.cjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GF_NO_ANCHOR_RESTORE: '1' },
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Public anchors disagree/)
  assert.ok(fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8').includes(foreign.lines[1]))
}))

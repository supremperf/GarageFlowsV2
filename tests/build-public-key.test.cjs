'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { generateKeyPairSync, createHash, createPublicKey } = require('node:crypto')
const { materializePublicKey } = require('../scripts/materialize-build-public-key.cjs')
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-public-'))
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const fp = createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
  for (const [file, variable] of [['electron/main.js', '_PK'], ['src/lib/license/public-key.ts', '_LINES']]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), `const ${variable} = ${JSON.stringify(pem.trim().split('\n')).replaceAll('"', "'")}`)
  }
  fs.mkdirSync(path.join(root, 'src/lib/license/__tests__'))
  fs.writeFileSync(path.join(root, 'src/lib/license/__tests__/public-key-consistency.test.ts'), `const REFERENCE_FP = '${fp}'`)
  try { fn(root, pem) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
test('restores same public key idempotently, never creates private key', () => fixture((root, pem) => {
  assert.equal(materializePublicKey(root), 'created')
  assert.equal(materializePublicKey(root), 'unchanged')
  assert.equal(fs.readFileSync(path.join(root, 'keys/public.pem'), 'utf8'), pem)
  assert.deepEqual(fs.readdirSync(path.join(root, 'keys')), ['public.pem'])
}))
test('preserves existing mismatched resource and refuses overwrite', () => fixture(root => {
  fs.mkdirSync(path.join(root, 'keys')); fs.writeFileSync(path.join(root, 'keys/public.pem'), 'existing-user-file')
  assert.throws(() => materializePublicKey(root))
  assert.equal(fs.readFileSync(path.join(root, 'keys/public.pem'), 'utf8'), 'existing-user-file')
}))
test('rejects disagreement between anchors before writing any resource', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'src/lib/license/__tests__/public-key-consistency.test.ts'), `const REFERENCE_FP = '${'0'.repeat(64)}'`)
  assert.throws(() => materializePublicKey(root), /disagree/)
  assert.equal(fs.existsSync(path.join(root, 'keys/public.pem')), false)
}))

test('refuses a symlink directory without writing outside the fixture', () => fixture(root => {
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'gf-public-external-'))
  try { fs.symlinkSync(external,path.join(root,'keys'),'junction'); assert.throws(()=>materializePublicKey(root)); assert.deepEqual(fs.readdirSync(external),[]) }
  finally { fs.rmSync(external,{recursive:true,force:true}) }
}))
test('a replaced pathname cannot change the descriptor already being checked', () => fixture((root,pem) => {
  materializePublicKey(root)
  const original=fs.readFileSync;let descriptorRead=false
  fs.readFileSync=function(file,...args){if(typeof file==='number'){descriptorRead=true;fs.renameSync(path.join(root,'keys/public.pem'),path.join(root,'keys/original.pem'));fs.writeFileSync(path.join(root,'keys/public.pem'),'replacement-preserved')}return original.call(fs,file,...args)}
  try { assert.equal(materializePublicKey(root),'unchanged');assert.equal(descriptorRead,true);assert.equal(original(path.join(root,'keys/public.pem'),'utf8'),'replacement-preserved');assert.equal(original(path.join(root,'keys/original.pem'),'utf8'),pem) }
  finally {fs.readFileSync=original}
}))

// ── Diagnostic de désaccord : bloquant ET explicite ─────────────────────────
const { spawnSync } = require('node:child_process')
const { inspectAnchors } = require('../scripts/materialize-build-public-key.cjs')
function otherKeyLines() {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { pem, lines: pem.trim().split('\n'), fp: createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex') }
}
function writeLiteral(root, file, variable, lines, extra = '') {
  fs.writeFileSync(path.join(root, file), `${extra}const ${variable} = ${JSON.stringify(lines).replaceAll('"', "'")}`)
}

test('names the divergent anchors and refuses when _PK and _LINES share a locally regenerated key', () => fixture(root => {
  const other = otherKeyLines()
  writeLiteral(root, 'electron/main.js', '_PK', other.lines)
  writeLiteral(root, 'src/lib/license/public-key.ts', '_LINES', other.lines)
  let error
  try { materializePublicKey(root) } catch (e) { error = e }
  assert.ok(error, 'disagreement must stay blocking')
  assert.equal(error.code, 'GF_PUBLIC_ANCHORS_DISAGREE')
  assert.match(error.message, /^Public anchors disagree; no key file written/)
  assert.ok(error.message.includes(other.fp), 'the divergent fingerprint is reported')
  assert.match(error.message, /electron\/main\.js \(_PK\)/)
  assert.match(error.message, /keys:sync/)
  // Fixture outside any git repository (ZIP-like): no `git restore` advice, no "modified" claim.
  assert.doesNotMatch(error.message, /git restore --source=HEAD/)
  assert.doesNotMatch(error.message, /modifié localement/)
  assert.match(error.message, /dossier sans git \(ZIP\)/)
  assert.equal(fs.existsSync(path.join(root, 'keys/public.pem')), false)
}))

test('inside its OWN git repository, locally modified anchors are reported and git restore is advised', () => fixture(root => {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (git('init', '-q').status !== 0) return
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  const other = otherKeyLines()
  writeLiteral(root, 'electron/main.js', '_PK', other.lines)
  const error = (() => { try { materializePublicKey(root) } catch (e) { return e } })()
  assert.match(error.message, /electron\/main\.js \(_PK\)\n\s+[0-9a-f]{64}  ✗ DIFFÉRENTE  — modifié localement/)
  assert.match(error.message, /git restore --source=HEAD/)
}))

test('a PARENT git repository does not make project files look "modified"', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-parent-'))
  try {
    if (spawnSync('git', ['init', '-q'], { cwd: parent }).status !== 0) return
    fixture(root => {
      const nested = path.join(parent, 'Desktop', 'GarageFlowsV2-zip')
      fs.mkdirSync(path.dirname(nested), { recursive: true })
      fs.cpSync(root, nested, { recursive: true })
      writeLiteral(nested, 'electron/main.js', '_PK', otherKeyLines().lines)
      const error = (() => { try { materializePublicKey(nested) } catch (e) { return e } })()
      assert.doesNotMatch(error.message, /modifié localement/)
      assert.match(error.message, /hors dépôt git/)
    })
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('a partial update (only one literal changed) is diagnosed as partial and refused', () => fixture(root => {
  writeLiteral(root, 'src/lib/license/public-key.ts', '_LINES', otherKeyLines().lines)
  assert.throws(() => materializePublicKey(root), e => /PARTIELLE/.test(e.message) && /disagree/.test(e.message))
  assert.equal(fs.existsSync(path.join(root, 'keys')), false)
}))

test('an ambiguous anchor (two declarations) is refused instead of trusting the first match', () => fixture((root, pem) => {
  const current = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  fs.writeFileSync(path.join(root, 'electron/main.js'), `${current}\nconst _PK = ${JSON.stringify(otherKeyLines().lines).replaceAll('"', "'")}`)
  const inspection = inspectAnchors(root)
  assert.equal(inspection.agree, false)
  assert.match(inspection.anchors[0].error, /2 littéral/)
  assert.throws(() => materializePublicKey(root), /disagree/)
  // Same for a duplicated REFERENCE_FP, even when both values are identical-looking.
  fs.writeFileSync(path.join(root, 'electron/main.js'), current)
  const ref = path.join(root, 'src/lib/license/__tests__/public-key-consistency.test.ts')
  fs.appendFileSync(ref, `\n${fs.readFileSync(ref, 'utf8')}`)
  assert.throws(() => materializePublicKey(root), /REFERENCE_FP est absent, dupliqué/)
  assert.ok(pem)
}))

test('a retired key is flagged as such in the diagnostic', () => fixture(root => {
  const other = otherKeyLines()
  writeLiteral(root, 'electron/main.js', '_PK', other.lines)
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts/check-critical-files.js'), `const RETIRED_FINGERPRINTS = [\n  { fp: '${other.fp}', retired: '2026-08-16 (rotation)' },\n]`)
  assert.throws(() => materializePublicKey(root), /clé RETIRÉE \(2026-08-16 \(rotation\)\)/)
}))

test('preflight stops with the full diagnostic and exit code 1, not a bare stack trace', () => fixture(root => {
  fs.mkdirSync(path.join(root, 'scripts'))
  for (const f of ['preflight-release.cjs', 'materialize-build-public-key.cjs', 'restore-public-anchors.cjs']) fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(root, 'scripts', f))
  // Both literals on a foreign key and NO proof of the reference key available offline.
  const other = otherKeyLines()
  writeLiteral(root, 'electron/main.js', '_PK', other.lines)
  writeLiteral(root, 'src/lib/license/public-key.ts', '_LINES', other.lines)
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/preflight-release.cjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GF_ANCHOR_RESTORE_NETWORK: '0' },
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Empaquetage refusé/)
  assert.match(run.stderr, /Public anchors disagree/)
  assert.match(run.stderr, /Réparation automatique impossible/)
  assert.ok(fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8').includes(other.lines[1]), 'nothing rewritten without proof')
  assert.doesNotMatch(run.stderr, /at materializePublicKey/)
  assert.equal(fs.existsSync(path.join(root, 'keys/public.pem')), false)
}))

test('an existing different keys/public.pem is preserved and both fingerprints are reported', () => fixture(root => {
  const other = otherKeyLines()
  fs.mkdirSync(path.join(root, 'keys')); fs.writeFileSync(path.join(root, 'keys/public.pem'), other.pem)
  assert.throws(() => materializePublicKey(root), e => e.code === 'GF_PUBLIC_RESOURCE_DIFFERS' && e.message.includes(other.fp))
  assert.equal(fs.readFileSync(path.join(root, 'keys/public.pem'), 'utf8'), other.pem)
}))

// ── keys:sync : tout ou rien ────────────────────────────────────────────────
function syncFixture(fn) {
  fixture((root) => {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'sync-public-key.mjs'), path.join(root, 'scripts', 'sync-public-key.mjs'))
    fs.writeFileSync(path.join(root, 'scripts/check-critical-files.js'), "const RETIRED_FINGERPRINTS = [\n  { fp: '" + 'a'.repeat(64) + "', retired: 'old' },\n]\n")
    const next = otherKeyLines()
    fs.mkdirSync(path.join(root, 'keys')); fs.writeFileSync(path.join(root, 'keys/public.pem'), next.pem)
    fn(root, next)
  })
}
const snapshot = root => ['electron/main.js', 'src/lib/license/public-key.ts', 'src/lib/license/__tests__/public-key-consistency.test.ts', 'scripts/check-critical-files.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))

test('keys:sync moves the three anchors together, then the materializer agrees', () => syncFixture((root, next) => {
  const before = inspectAnchors(root).expected
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-public-key.mjs')], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const after = inspectAnchors(root)
  assert.equal(after.agree, true)
  assert.equal(after.expected, next.fp)
  assert.match(fs.readFileSync(path.join(root, 'scripts/check-critical-files.js'), 'utf8'), new RegExp(before))
  assert.deepEqual(fs.readdirSync(path.join(root, 'src/lib/license')).filter(f => f.endsWith('.tmp')), [])
  assert.equal(materializePublicKey(root), 'unchanged')
}))

test('keys:sync leaves NO partial state when one anchor cannot be written', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => syncFixture(root => {
  const before = snapshot(root)
  const locked = path.join(root, 'src/lib/license/__tests__')
  fs.chmodSync(locked, 0o555)
  try {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-public-key.mjs')], { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /aucun fichier modifié/)
  } finally { fs.chmodSync(locked, 0o755) }
  assert.deepEqual(snapshot(root), before, 'every anchor keeps its original content')
  assert.equal(inspectAnchors(root).agree, true)
  for (const dir of ['electron', 'src/lib/license', 'src/lib/license/__tests__', 'scripts']) {
    assert.deepEqual(fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.tmp')), [])
  }
}))

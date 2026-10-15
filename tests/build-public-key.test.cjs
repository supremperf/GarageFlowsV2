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

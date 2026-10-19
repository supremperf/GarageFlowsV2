'use strict'
// keys:find-issuer — finds the PRODUCTION licence private key by fingerprint only,
// never prints key material, moves the wrong key OUT of the project (never deletes).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { generateKeyPairSync, createHash, createPublicKey, createPrivateKey } = require('node:crypto')
const { main } = require('../scripts/find-issuer-key.cjs')

function pair(passphrase) {
  const enc = passphrase ? { cipher: 'aes-256-cbc', passphrase } : {}
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem', ...enc } })
  const fp = createHash('sha256').update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })).digest('hex')
  return { publicKey, privateKey, fp }
}
const fpOfPrivate = pem => createHash('sha256').update(createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' })).digest('hex')

async function world(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-find-'))
  const prod = pair(), local = pair()
  const project = path.join(base, 'Desktop', 'GarageFlowsV2-new')
  const literal = (v, pem) => `const ${v} = [\n${pem.trim().split('\n').map(l => `  '${l}',`).join('\n')}\n]\n`
  for (const [file, text] of [['electron/main.js', literal('_PK', prod.publicKey)], ['src/lib/license/public-key.ts', literal('_LINES', prod.publicKey)],
    ['src/lib/license/__tests__/public-key-consistency.test.ts', `const REFERENCE_FP = '${prod.fp}'\n`],
    ['keys/private.pem', local.privateKey], ['keys/public.pem', local.publicKey]]) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true })
    fs.writeFileSync(path.join(project, file), text)
  }
  const logs = []
  const run = (argv = [], extra = {}) => main(argv, { root: project, roots: [path.join(base, 'Desktop')], log: l => logs.push(l), error: l => logs.push(l), backupBase: path.join(base, 'aside'), ...extra })
  try { return await fn({ base, project, prod, local, logs, run }) } finally { fs.rmSync(base, { recursive: true, force: true }) }
}

test('finds the production key in an OLD project folder, installs it, sets the wrong one aside outside the project', () => world(async ({ base, project, prod, local, logs, run }) => {
  const old = path.join(base, 'Desktop', 'GarageFlowsV2-old', 'keys')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'private.pem'), prod.privateKey)
  assert.equal(await run(), 0)
  assert.equal(fpOfPrivate(fs.readFileSync(path.join(project, 'keys/private.pem'), 'utf8')), prod.fp)
  const aside = fs.readdirSync(path.join(base, 'aside'))
  assert.equal(aside.length, 1)
  assert.equal(fpOfPrivate(fs.readFileSync(path.join(base, 'aside', aside[0], 'private.pem'), 'utf8')), local.fp, 'wrong key preserved, not deleted')
  const text = logs.join('\n')
  assert.ok(!text.includes('PRIVATE KEY') && !text.includes(prod.privateKey.split('\n')[1]), 'no key material printed')
  assert.match(text, new RegExp(local.fp.slice(0, 16)), 'the non-production key is named by fingerprint')
}))

test('finds it as GF_PRIVATE_KEY (base64) in an old .env.server.local', () => world(async ({ base, project, prod, run }) => {
  const dir = path.join(base, 'Desktop', 'ancien')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '.env.server.local'), `A=1\nGF_PRIVATE_KEY="${Buffer.from(prod.privateKey).toString('base64')}"\n`)
  assert.equal(await run(), 0)
  assert.equal(fpOfPrivate(fs.readFileSync(path.join(project, 'keys/private.pem'), 'utf8')), prod.fp)
}))

test('nothing found: exit 1, nothing moved, nothing generated', () => world(async ({ project, local, logs, run }) => {
  assert.equal(await run(), 1)
  assert.equal(fpOfPrivate(fs.readFileSync(path.join(project, 'keys/private.pem'), 'utf8')), local.fp)
  assert.match(logs.join('\n'), /Aucune clé privée correspondant à la production/)
}))

test('--dry-run reports without installing', () => world(async ({ base, project, prod, local, run }) => {
  const old = path.join(base, 'Desktop', 'old', 'keys')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'private.pem'), prod.privateKey)
  assert.equal(await run(['--dry-run']), 0)
  assert.equal(fpOfPrivate(fs.readFileSync(path.join(project, 'keys/private.pem'), 'utf8')), local.fp)
}))

test('encrypted production key: listed without passphrase, verified and installed with it', () => world(async ({ base, project, prod, logs, run }) => {
  const enc = pair('s3cret')
  // Re-pin the project on the encrypted key's public half.
  const literal = (v, pem) => `const ${v} = [\n${pem.trim().split('\n').map(l => `  '${l}',`).join('\n')}\n]\n`
  fs.writeFileSync(path.join(project, 'electron/main.js'), literal('_PK', enc.publicKey))
  fs.writeFileSync(path.join(project, 'src/lib/license/public-key.ts'), literal('_LINES', enc.publicKey))
  fs.writeFileSync(path.join(project, 'src/lib/license/__tests__/public-key-consistency.test.ts'), `const REFERENCE_FP = '${enc.fp}'\n`)
  const old = path.join(base, 'Desktop', 'old', 'keys')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'private.pem'), enc.privateKey)
  assert.equal(await run(), 1)
  assert.match(logs.join('\n'), /CHIFFRÉES non vérifiées/)
  assert.equal(await run([], { passphrase: 's3cret' }), 0)
  assert.equal(fs.readFileSync(path.join(project, 'keys/private.pem'), 'utf8'), enc.privateKey)
  assert.ok(prod)
}))

test('already the production key: nothing to do', () => world(async ({ base, project, prod, run }) => {
  fs.writeFileSync(path.join(project, 'keys/private.pem'), prod.privateKey)
  fs.writeFileSync(path.join(project, 'keys/public.pem'), prod.publicKey)
  assert.equal(await run(), 0)
  assert.equal(fs.existsSync(path.join(base, 'aside')), false)
}))

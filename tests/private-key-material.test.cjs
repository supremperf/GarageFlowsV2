'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { containsPrivateKeyMaterial } = require('../scripts/lib/private-key-material.cjs')
const { scanVersionedPrivateKeys } = require('../scripts/lib/scan-versioned-private-keys.cjs')

function git(root, args, input) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    windowsHide: true,
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.error?.message || ''}`)
  return result.stdout.trim()
}

function repository(t) {
  // Spaces are intentional: every Git invocation must be argument-safe on Windows.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'GarageFlows source scan '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  git(root, ['init'])
  git(root, ['config', 'user.name', 'GarageFlows Scanner Test'])
  git(root, ['config', 'user.email', 'scanner-test@invalid.example'])
  return root
}

function write(root, relativePath, contents) {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

function stageGitSymlink(root, relativePath, target) {
  const link = write(root, relativePath, target)
  const object = git(root, ['hash-object', '-w', '--stdin'], target)
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${object},${relativePath}`])
  return link
}

function generatedPrivatePem() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

test('multiline P256 and short Ed25519 PKCS8 material are detected in plain and JSON strings', () => {
  for (const options of [{ kind: 'ec', params: { namedCurve: 'prime256v1' } }, { kind: 'ed25519', params: {} }]) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync(options.kind, options.params)
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    assert.equal(containsPrivateKeyMaterial(pem), true)
    assert.equal(containsPrivateKeyMaterial(JSON.stringify({ value: pem })), true)
    assert.equal(containsPrivateKeyMaterial(publicKey.export({ type: 'spki', format: 'pem' })), false)
  }
})

test('encrypted private material is rejected without any passphrase request', () => {
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
  const pem = key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'fixture-only-not-a-production-secret' })
  assert.equal(containsPrivateKeyMaterial(pem), true)
})

test('marker literals, unrelated Base64 and malformed PEM are not private keys', () => {
  assert.equal(containsPrivateKeyMaterial("const marker = '-----BEGIN PRIVATE KEY-----';"), false)
  const base64 = Buffer.from('documentation, a content hash, and sample data').toString('base64')
  const malformed = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`
  assert.equal(containsPrivateKeyMaterial(malformed), false)
  assert.equal(containsPrivateKeyMaterial(`marker\n${'A'.repeat(160)}`), false)
})

test('versioned scan inspects source, config, Prisma, docs and examples; binary files are skipped', (t) => {
  const root = repository(t)
  const realKey = generatedPrivatePem()
  // PEM armour assembled at run time: the source no longer holds a complete PEM
  // block for the secret scanner to flag. The produced string is unchanged, so the
  // assertion below still covers the very same false-positive case.
  const armour = bound => `-----${bound} PRIVATE KEY-----`
  const falsePositive = [armour('BEGIN'), Buffer.from('not ASN.1 key material').toString('base64'), armour('END')].join('\n')
  const importantFiles = [
    'src/client.tsx',
    'scripts/check.js',
    'electron/preload.js',
    'configuation automatique/config.js',
    'prisma/schema.prisma',
    'docs/security.md',
    '.env.example',
  ]
  for (const file of importantFiles) {
    write(root, file, file === 'configuation automatique/config.js'
      ? `// fixture only\n${realKey}`
      : `// legitimate source text\n${falsePositive}\n`)
  }
  write(root, 'keys/public.pem', crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }))
  write(root, 'assets/opaque.bin', Buffer.concat([Buffer.from('marker '), Buffer.from([0]), Buffer.from(' PRIVATE KEY-----')]))
  git(root, ['add', '--', '.'])

  const scan = scanVersionedPrivateKeys(root)
  assert.deepEqual(scan.issues, [])
  assert.deepEqual(scan.findings, ['configuation automatique/config.js'])
  assert.ok(scan.candidateFileCount >= importantFiles.length - 1)
  for (const file of importantFiles) assert.ok(scan.trackedPaths.includes(file), `${file} is in the Git inventory`)
  assert.ok(scan.trackedPaths.includes('keys/public.pem'))
  assert.ok(scan.trackedPaths.includes('assets/opaque.bin'))
  assert.equal(scan.untrackedSourceCount, 0)
})

test('tracked symlink target is scanned; a link outside the repository fails closed', (t) => {
  const root = repository(t)
  const realKey = generatedPrivatePem()
  write(root, 'secrets/private-fixture', realKey)
  stageGitSymlink(root, 'src/private-alias.ts', '../secrets/private-fixture')

  const inside = scanVersionedPrivateKeys(root)
  assert.deepEqual(inside.issues, [])
  assert.deepEqual(inside.findings, ['src/private-alias.ts'])
  assert.equal(inside.symlinkCount, 1)

  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'GarageFlows external key '))
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }))
  const outside = write(outsideRoot, 'not-for-repo.pem', realKey)
  stageGitSymlink(root, 'src/external-alias.ts', outside)

  const refused = scanVersionedPrivateKeys(root)
  assert.deepEqual(refused.findings, ['src/private-alias.ts'])
  assert.ok(refused.issues.some((issue) => issue.startsWith('src/external-alias.ts: lien symbolique sortant du dépôt')))
})

test('library header literals are not private keys, and delivery scans cannot skip large files or failed extraction', () => {
  assert.equal(containsPrivateKeyMaterial("const marker = '-----BEGIN PRIVATE KEY-----';"), false)
  const scanner = fs.readFileSync(path.join(__dirname, '../scripts/check-artifact-secrets.mjs'), 'utf8')
  assert.match(scanner, /PRIVATE_BLOCK\.test\(text\) \|\| containsPrivateKeyMaterial\(text\)/)
  assert.match(scanner, /FICHIER NON INSPECTÉ/)
  assert.match(scanner, /while \(\(length = readSync/)
  assert.ok(!scanner.includes('size > 220'))
})

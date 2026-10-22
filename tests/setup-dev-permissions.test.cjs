'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-setup-env-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, 'app')
  fs.mkdirSync(path.join(app, 'scripts', 'lib'), { recursive: true })
  fs.mkdirSync(path.join(app, 'prisma'), { recursive: true })
  for (const file of ['setup-dev.js', 'secrets.js', 'lib/preserve-legacy-dev-db.cjs']) {
    fs.copyFileSync(path.join('scripts', file), path.join(app, 'scripts', file))
  }
  // Un modèle non vide évite tout recours au CLI Prisma dans ce test du bootstrap.
  fs.writeFileSync(path.join(app, 'prisma', 'garageflow-template.db'), 'test-template-not-a-real-database')
  return app
}

function runSetup(app) {
  const result = spawnSync(process.execPath, [path.join(app, 'scripts', 'setup-dev.js')], {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  })
  assert.equal(result.status, 0, result.stderr)
  return result
}

test('actual setup-dev preserves a strong secret and restricts an existing .env', {
  skip: process.platform === 'win32' ? 'POSIX permission bits are not NTFS ACLs' : false,
}, (t) => {
  const app = fixture(t)
  const envPath = path.join(app, '.env')
  const strongSecret = 'Zm9vYmFyYmF6cXV4c2VjcmV0MTIzNDU2Nzg5MA=='
  const original = `DATABASE_URL="file:./dev.db"\nNEXTAUTH_SECRET="${strongSecret}"\n`
  fs.writeFileSync(envPath, original, { encoding: 'utf8', mode: 0o644 })
  fs.chmodSync(envPath, 0o644)

  runSetup(app)

  assert.equal(fs.readFileSync(envPath, 'utf8'), original, 'the existing secret and configuration must be unchanged')
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600)
})

test('actual setup-dev creates a private .env and keeps it private on later runs', {
  skip: process.platform === 'win32' ? 'POSIX permission bits are not NTFS ACLs' : false,
}, (t) => {
  const app = fixture(t)
  fs.writeFileSync(path.join(app, '.env.example'), [
    'DATABASE_URL="file:./dev.db"',
    'NEXTAUTH_SECRET=',
    `# ${'-'.repeat(70)}`,
    '',
  ].join('\n'))

  runSetup(app)
  const envPath = path.join(app, '.env')
  const generated = fs.readFileSync(envPath, 'utf8')
  assert.ok(generated.includes('NEXTAUTH_SECRET='))
  const generatedSecret = generated.match(/^NEXTAUTH_SECRET="([^"]+)"$/m)?.[1] ?? ''
  assert.ok(generatedSecret.length >= 32, 'an empty value must not inherit the following comment as its secret')
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600)

  fs.chmodSync(envPath, 0o644)
  runSetup(app)
  assert.equal(fs.readFileSync(envPath, 'utf8'), generated, 'the second run must not rotate the secret')
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600)
})

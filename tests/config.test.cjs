'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const c = require('../scripts/config-core.cjs')
const root = path.resolve(__dirname, '..')
const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
const names = [...new Set([...c.templateNames(template), ...require('../scripts/config-policy.cjs').loadPolicy(root).names])]
function server() {
  return c.fillMissing({ DATABASE_URL: 'postgresql://user:pass@ep-test-pooler.neon.tech/garage?sslmode=require',
    DIRECT_URL: 'postgresql://user:pass@ep-test.neon.tech/garage?sslmode=require',
    NEXTAUTH_URL: 'https://app.test.invalid', UPSTASH_REDIS_REST_URL: 'https://redis.test.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'test-only-redis-token' }, c.namesForProfile(names, 'pwa'), 'pwa')
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-config-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('extracts every documented variable including commented fields', () => {
  for (const n of ['DIRECT_URL', 'GF_PRIVATE_KEY', 'GF_UPDATE_SIGNING_KEY',
    'GF_EINVOICE_CREDENTIALS_KEY_VERSION', 'RATE_LIMIT_ADMIN_MAX']) assert.ok(names.includes(n), n)
  assert.equal(new Set(names).size, names.length)
})
test('profiles exclude publication private key and keep server credentials out of desktop', () => {
  const desktop = c.namesForProfile(names, 'desktop')
  for (const n of ['DIRECT_URL', 'GF_PRIVATE_KEY', 'DEVICE_TOKEN_PEPPER', 'GARAGEFLOW_API_KEY',
    'UPSTASH_REDIS_REST_TOKEN', 'GF_EINVOICE_CREDENTIALS_KEY', 'GF_UPDATE_SIGNING_KEY']) assert.ok(!desktop.includes(n), n)
  for (const profile of ['pwa', 'licences']) {
    assert.ok(!c.namesForProfile(names, profile).includes('GF_UPDATE_SIGNING_KEY'))
    assert.ok(!c.namesForProfile(names, profile).includes('LICENSE_ENFORCEMENT'))
  }
})
test('generates independent 32-byte keys and never replaces existing values', () => {
  const before = { NEXTAUTH_SECRET: 'existing-even-if-weak', GF_SMTP_CIPHER_KEY: 'old-key' }
  const after = c.fillMissing(before, names, 'pwa')
  assert.deepEqual(before, { NEXTAUTH_SECRET: 'existing-even-if-weak', GF_SMTP_CIPHER_KEY: 'old-key' })
  assert.equal(after.NEXTAUTH_SECRET, before.NEXTAUTH_SECRET)
  assert.equal(after.GF_SMTP_CIPHER_KEY, before.GF_SMTP_CIPHER_KEY)
  const fresh = c.fillMissing({}, names, 'pwa')
  const keys = Object.keys(c.GENERATED).map(n => fresh[n])
  assert.equal(new Set(keys).size, keys.length)
  for (const n of Object.keys(c.GENERATED)) assert.equal(Buffer.from(fresh[n], c.GENERATED[n]).length, 32)
  assert.equal(fresh.EINVOICING_ENABLED, 'false')
  assert.equal(fresh.GF_EINVOICE_CREDENTIALS_KEY, undefined)
  assert.equal(fresh.GF_PRIVATE_KEY, undefined)
  assert.equal(fresh.GF_UPDATE_SIGNING_KEY, undefined)
})
test('dotenv roundtrip preserves dollars, hashes, empty lines, comments and CRLF', () => {
  const original = { DATABASE_URL: 'postgresql://u:pass%23word@host/db', NEXTAUTH_SECRET: 'abc$def#ghi' }
  const text = c.serializeEnv(original, ['DATABASE_URL', 'NEXTAUTH_SECRET', 'DIRECT_URL'], 'pwa')
  assert.deepEqual({ ...c.parseEnv(text.replace(/\n/g, '\r\n')) }, original)
  const parsed = c.parseEnv('A=\n# comment\nB="abc#123" # note\nC=word # note\nD=\'single # quoted\'\nE="a\\nb"\n')
  assert.deepEqual({ ...parsed }, { A: '', B: 'abc#123', C: 'word', D: 'single # quoted', E: 'a\nb' })
})
test('malformed quoted secrets fail closed rather than triggering regeneration', () => {
  assert.throws(() => c.parseEnv('NEXTAUTH_SECRET="unterminated'), /NEXTAUTH_SECRET/)
  assert.throws(() => c.parseEnv("GF_PRIVATE_KEY='unterminated"), /GF_PRIVATE_KEY/)
})
test('does not serialize PEM multiline values or unsafe quoting', () => {
  for (const v of ['raw\nPEM', 'value"quote', 'a\\b']) {
    assert.throws(() => c.serializeEnv({ GF_PRIVATE_KEY: v }, ['GF_PRIVATE_KEY'], 'licences'))
  }
})
test('production validator requires PostgreSQL, direct endpoint, HTTPS, Redis and pepper', () => {
  const good = server()
  assert.deepEqual(c.validate(good, 'pwa', { vercel: true }), [])
  for (const n of ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_URL', 'DEVICE_TOKEN_PEPPER',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GF_DB_MAC_SECRET']) {
    const invalid = { ...good }; delete invalid[n]
    assert.ok(c.validate(invalid, 'pwa', { vercel: true }).some(e => e.startsWith(n)), n)
  }
  for (const [n, value] of [['DATABASE_URL', 'file:./dev.db'], ['DIRECT_URL', good.DATABASE_URL],
    ['NEXTAUTH_URL', 'http://app.invalid'], ['UPSTASH_REDIS_REST_URL', 'rediss://redis.invalid']]) {
    assert.ok(c.validate({ ...good, [n]: value }, 'pwa', { vercel: true }).some(e => e.startsWith(n)), n)
  }
})
test('self-hosted production requires declared trusted proxy, Vercel does not', () => {
  assert.ok(c.validate(server(), 'pwa').some(e => e.startsWith('TRUST_PROXY_HEADERS')))
  assert.deepEqual(c.validate({ ...server(), TRUST_PROXY_HEADERS: '1' }, 'pwa'), [])
})
test('desktop uses SQLite defaults and has no server dependency', () => {
  const selected = c.namesForProfile(names, 'desktop')
  const env = c.fillMissing({}, selected, 'desktop')
  assert.equal(env.DATABASE_URL, 'file:./dev.db')
  assert.deepEqual(c.validate(env, 'desktop'), [])
  assert.ok(c.validate({ ...env, DATABASE_URL: server().DATABASE_URL }, 'desktop').length)
})
test('checks AES lengths, old keys, weak secrets, limits and optional enums', () => {
  const good = server()
  const invalid = {
    GF_SMTP_CIPHER_KEY: 'wrong', GF_BACKUP_KEY: 'wrong', GF_SMTP_CIPHER_KEY_OLD: 'wrong,wrong',
    NEXTAUTH_SECRET: 'placeholder_123456789012345678901234567890',
    RATE_LIMIT_API_MAX: '0', RATE_LIMIT_API_WINDOW_SECONDS: '1.5',
    UPSTASH_REDIS_TIMEOUT_MS: '15000', GF_INTEGRITY_MODE: 'bad', GF_UPDATE_CHANNEL: 'bad',
    GF_DEVICE_AUTH_DEADLINE: 'tomorrow', GF_MIN_PWA_VERSION: 'not-a-version',
    GF_EINVOICE_CREDENTIALS_KEY_VERSION: '0', EINVOICING_ENABLED: 'yes',
  }
  for (const [n, v] of Object.entries(invalid)) {
    assert.ok(c.validate({ ...good, [n]: v }, 'pwa', { vercel: true }).some(e => e.startsWith(n)), n)
  }
  assert.deepEqual(c.validate({ ...good, GF_SMTP_CIPHER_KEY_OLD: `${good.GF_SMTP_CIPHER_KEY},${good.GF_BACKUP_KEY}` }, 'pwa', { vercel: true }), [])
})
test('electronic invoicing never enables itself or silently generates its encryption key', () => {
  const good = server()
  assert.equal(good.EINVOICING_ENABLED, 'false')
  assert.ok(c.validate({ ...good, EINVOICING_ENABLED: 'true' }, 'pwa', { vercel: true }).some(e => e.startsWith('GF_EINVOICE_CREDENTIALS_KEY')))
  const enabled = { ...good, EINVOICING_ENABLED: 'true', GF_EINVOICE_CREDENTIALS_KEY: crypto.randomBytes(32).toString('base64') }
  assert.deepEqual(c.validate(enabled, 'pwa', { vercel: true }), [])
})
test('license signing import must be P-256 and match embedded public key', () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const value = Buffer.from(pair.privateKey).toString('base64')
  assert.equal(c.licenseKeyMatches(value, pair.publicKey), true)
  assert.equal(c.licenseKeyMatches(value, c.embeddedLicenseKey(root)), false)
  assert.equal(c.licenseKeyMatches('invalid-base64', pair.publicKey), false)
  const env = { ...server(), GF_PRIVATE_KEY: value }
  assert.deepEqual(c.validate(env, 'licences', { vercel: true, publicPem: pair.publicKey }), [])
  assert.ok(c.validate(env, 'licences', { vercel: true, publicPem: c.embeddedLicenseKey(root) }).some(e => e.startsWith('GF_PRIVATE_KEY')))
})
test('sync plan only adds absent values; conflicts are not overwritten', () => {
  assert.deepEqual(c.syncPlan({ A: 'new', B: 'same', C: 'different', D: '' },
    { B: 'same', C: 'original', OTHER: 'unrelated' }, ['A', 'B', 'C', 'D']),
  { additions: ['A'], conflicts: ['C'] })
})
test('private writes are atomic, replace existing files and refuse symlinks', t => {
  const dir = fixture(t)
  const file = path.join(dir, 'secrets/.env')
  c.writePrivate(file, 'secret-value')
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-value')
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  c.writePrivate(file, 'second-value')
  assert.equal(fs.readFileSync(file, 'utf8'), 'second-value')
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['.env'])
  if (process.platform !== 'win32') {
    const link = path.join(dir, 'linked.env')
    fs.symlinkSync(file, link)
    assert.throws(() => c.writePrivate(link, 'bad'), /symbolique/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'second-value')
  }
})
test('CLI --check is offline/read-only and reports names, never secret values', t => {
  const dir = fixture(t)
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src/lib/license'), { recursive: true })
  for (const file of ['config', '.env.example', 'scripts/config-core.cjs', 'scripts/config-policy.cjs', 'scripts/garageflow-env-manifest.json', 'src/lib/license/public-key.ts']) {
    fs.copyFileSync(path.join(root, file), path.join(dir, file))
  }
  const secret = 'do-not-print-this-actual-secret-value'
  const env = { ...server(), NEXTAUTH_SECRET: secret }
  const file = path.join(dir, '.env.server.local')
  const text = c.serializeEnv(env, c.namesForProfile(names, 'pwa'), 'pwa')
  fs.writeFileSync(file, text)
  const run = spawnSync(process.execPath, [path.join(dir, 'config'), '--check', '--profile', 'pwa', '--vercel'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(!`${run.stdout}${run.stderr}`.includes(secret))
  assert.equal(fs.readFileSync(file, 'utf8'), text)
  env.DATABASE_URL = 'file:./dev.db'
  fs.writeFileSync(file, c.serializeEnv(env, c.namesForProfile(names, 'pwa'), 'pwa'))
  const bad = spawnSync(process.execPath, [path.join(dir, 'config'), '--check', '--profile', 'pwa', '--vercel'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /DATABASE_URL/)
  assert.ok(!`${bad.stdout}${bad.stderr}`.includes(secret))
})
test('CLI rejects unknown profiles and provides help without a TTY or network', () => {
  for (const args of [['--profile', 'unknown'], ['--check'], ['--unexpected']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'config'), ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
  }
  const help = spawnSync(process.execPath, [path.join(root, 'config'), '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Neon\/Vercel/)
})
test('all secret output paths are ignored by Git and Vercel', () => {
  const paths = ['.env', '.env.server.local', 'GarageFlow-configuration/pull-test/.env.production.local', 'keys/private.pem', '.vercel/project.json']
  for (const file of paths) {
    const ignored = spawnSync('git', ['check-ignore', file], { cwd: root, encoding: 'utf8' })
    assert.equal(ignored.status, 0, file)
  }
  const vercelignore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8')
  assert.match(vercelignore, /GarageFlow-configuration\//)
  assert.match(vercelignore, /\.env\.\*/)
})

test('interactive confirmations pass their visible label to readline (Windows redraw regression)', async () => {
  const readline = require('node:readline')
  const wizard = require('../config')
  const original = readline.createInterface
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const prompts = []
  const answers = ['instruction non pertinente', 'oui', 'oui']
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  readline.createInterface = () => ({
    once() {}, close() {},
    question(prompt, callback) { prompts.push(prompt); callback(answers.shift()) },
  })
  try {
    assert.equal(await wizard.yes('Autoriser la création du projet PostgreSQL GarageFlows'), true)
    assert.equal(prompts[0], 'Autoriser la création du projet PostgreSQL GarageFlows (oui/non) [non] : ')
    assert.equal(prompts[1], prompts[0], 'invalid text asks again rather than silently cancelling')
    await wizard.question('URL', { defaultValue: 'https://fixture-user:fixture-password@app.invalid' })
    assert.equal(prompts[2], 'URL [déjà configuré] : ')
    assert.ok(!prompts.join('\n').includes('fixture-password'))
  } finally {
    readline.createInterface = original
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else delete process.stdin.isTTY
  }
})

test('SQL diagnostic is read-only, uses the server profile and distinguishes drift from technical failure', async () => {
  const wizard = require('../config')
  for (const code of [0, 1, 2]) {
    const calls = []
    const result = await wizard.diagnoseSql({ env: server(), run: async (args, options) => {
      calls.push(args)
      assert.equal(options.env.ELECTRON, '')
      assert.equal(options.env.DATABASE_URL, server().DATABASE_URL)
      if (code) throw Object.assign(new Error('raw output must remain hidden'), { exitCode: code })
      return ''
    } })
    assert.equal(result, code)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].slice(1), ['migrate', 'diff', '--from-schema-datasource', 'prisma/server/schema.prisma', '--to-schema-datamodel', 'prisma/server/schema.prisma', '--exit-code'])
  }
})

test('subprocess failures retain exit status without exposing stdout or stderr', async () => {
  const wizard = require('../config')
  await assert.rejects(wizard.execute(['-e', 'console.log("fixture-secret"); console.error("fixture-secret"); process.exit(2)']), error => {
    assert.equal(error.exitCode, 2)
    assert.ok(!error.message.includes('fixture-secret'))
    return true
  })
})

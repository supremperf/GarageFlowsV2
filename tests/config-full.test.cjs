'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const core = require('../scripts/config-core.cjs')
const policy = require('../scripts/config-policy.cjs')
const services = require('../scripts/config-services.cjs')
const { full } = require('../scripts/config-full.cjs')
const root = path.resolve(__dirname, '..')
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-config-full-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function copy(dir, files) {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.copyFileSync(path.join(root, file), path.join(dir, file))
  }
}
function ecPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
}
function installPublic(dir, pub) {
  const file = path.join(dir, 'src/lib/license/public-key.ts')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `const _LINES = [\n${pub.trim().split('\n').map(s => `  '${s}',`).join('\n')}\n]\n`)
}

test('canonical policy classifies every manifest variable without deploying runtime or unused fields', () => {
  const p = policy.loadPolicy(root)
  assert.equal(p.entries.length, p.manifest.variables.length)
  assert.equal(new Set(p.entries.map(e => e.name)).size, p.entries.length)
  assert.ok(p.names.includes('GF_TOTP_ENC_KEY'))
  assert.ok(p.names.includes('GF_APP_URL'))
  assert.ok(p.names.includes('GF_MAX_MECHANIC_KEYS'))
  for (const e of p.entries) assert.ok(e.action && e.destination && e.reason)
  for (const n of ['GF_INTERNAL_EXPORT_KEY', 'GF_UPDATE_SIGNING_KEY', 'GF_KEYGEN_MAX_MECHANIC', 'GF_DEBUG', 'GF_BRAND_CONFIG', 'VERCEL_TOKEN']) assert.ok(!p.names.includes(n), n)
})
test('Redis PING uses a secret header, refuses redirects, never falls back', async () => {
  const env = { UPSTASH_REDIS_REST_URL: 'https://redis.test.invalid', UPSTASH_REDIS_REST_TOKEN: 'never-print-this' }
  await services.testRedis(env, async (url, options) => {
    assert.equal(url.hostname, 'redis.test.invalid')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer never-print-this')
    assert.equal(options.body, '["PING"]')
    return { ok: true, json: async () => ({ result: 'PONG' }) }
  })
  await assert.rejects(() => services.testRedis(env, async () => ({ ok: false })), /PING REST échoué/)
  await assert.rejects(() => services.testRedis({ ...env, UPSTASH_REDIS_REST_URL: 'http://redis.invalid' }, () => { throw new Error('must not run') }), /HTTPS/)
})
test('Redis provisioning requests an explicit free EU plan; never auto-upgrades to payg', async () => {
  const auth = { email: 'operator@test.invalid', apiKey: 'fake-management-key' }
  const result = await services.createFreeRedis(auth, async (url, options) => {
    assert.equal(url, 'https://api.upstash.com/v2/redis/database')
    assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body)
    assert.equal(body.plan, 'free')
    assert.equal(body.primary_region, 'eu-west-1')
    assert.equal(body.tls, true)
    assert.equal(body.eviction, false)
    return { ok: true, json: async () => ({ database_id: 'test-db-id', type: 'free' }) }
  })
  assert.equal(result.database_id, 'test-db-id')
  await assert.rejects(() => services.createFreeRedis(auth, async () => ({ ok: true, json: async () => ({ database_id: 'test-db-id', type: 'payg' }) })), /gratuite non confirmée/)
})
test('issuer config writes exactly the locations and field names read by Python', t => {
  const dir = tmp(t), pair = ecPair()
  installPublic(dir, pair.publicKey)
  const env = { GF_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64'), NEXTAUTH_URL: 'https://app.test.invalid/', GARAGEFLOW_API_KEY: crypto.randomBytes(32).toString('hex'), GF_MAX_MECHANIC_KEYS: '30' }
  services.configureKeygen(dir, env)
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'keys/server_config.json'), 'utf8'))
  assert.equal(cfg.url, 'https://app.test.invalid')
  assert.equal(cfg.api_key, env.GARAGEFLOW_API_KEY)
  assert.equal(cfg.max_mechanic, 30)
  assert.equal(fs.readFileSync(path.join(dir, 'keys/private.pem'), 'utf8'), pair.privateKey)
  assert.equal(services.publicFingerprint(fs.readFileSync(path.join(dir, 'keys/public.pem'))), services.publicFingerprint(pair.publicKey))
  assert.throws(() => services.configureKeygen(dir, { ...env, GARAGEFLOW_API_KEY: 'different' }), /clé API locale différente/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'keys/server_config.json'), 'utf8')).api_key, env.GARAGEFLOW_API_KEY)
})
test('client defaults align all compiled URLs and permit only the authorized update host', t => {
  const dir = tmp(t)
  copy(dir, ['electron/license-endpoint.js', 'electron/main.js', 'electron/update-verify.js', 'src/lib/public-url.ts', 'scripts/sign-release-manifest.mjs'])
  const changed = services.patchClientDefaults(dir, 'https://own-cloud.test.invalid')
  assert.equal(changed.length, 5)
  assert.match(fs.readFileSync(path.join(dir, 'electron/license-endpoint.js'), 'utf8'), /OFFICIAL_LICENSE_SERVER = 'https:\/\/own-cloud.test.invalid'/)
  assert.match(fs.readFileSync(path.join(dir, 'electron/main.js'), 'utf8'), /\|\| 'https:\/\/own-cloud.test.invalid'/)
  assert.match(fs.readFileSync(path.join(dir, 'src/lib/public-url.ts'), 'utf8'), /OFFICIAL_PUBLIC_APP_URL = 'https:\/\/own-cloud.test.invalid'/)
  const verifier = fs.readFileSync(path.join(dir, 'electron/update-verify.js'), 'utf8')
  assert.match(verifier, /'own-cloud.test.invalid'/)
  assert.match(verifier, /'api.garageflows.fr'/)
  assert.deepEqual(services.patchClientDefaults(dir, 'https://own-cloud.test.invalid'), [])
  assert.throws(() => services.patchClientDefaults(dir, 'https://name:password@own-cloud.test.invalid'), /URL publique/)
})
test('publisher private key stays outside repository; all historical verification keys are retained', t => {
  const base = tmp(t), dir = path.join(base, 'repo'), vault = path.join(base, 'vault/key.pem')
  fs.mkdirSync(dir)
  copy(dir, ['electron/update-verify.js', 'electron/semver.js'])
  const before = require(path.join(dir, 'electron/update-verify.js')).PUBLIC_KEYS
  const pair = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const result = services.installPublisherKey(dir, vault, pair.privateKey)
  assert.equal(fs.readFileSync(vault, 'utf8'), pair.privateKey)
  const source = fs.readFileSync(path.join(dir, 'electron/update-verify.js'), 'utf8')
  assert.ok(!source.includes(pair.privateKey))
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'GarageFlow-configuration/publisher.json'), 'utf8'))
  assert.equal(cfg.keyFile, vault)
  assert.ok(!JSON.stringify(cfg).includes(pair.privateKey))
  delete require.cache[require.resolve(path.join(dir, 'electron/update-verify.js'))]
  const after = require(path.join(dir, 'electron/update-verify.js')).PUBLIC_KEYS
  for (const id of Object.keys(before)) assert.equal(after[id], before[id])
  assert.equal(services.publicFingerprint(after[result.keyId]), services.publicFingerprint(pair.publicKey))
  services.installPublisherKey(dir, vault, pair.privateKey)
  assert.equal(fs.readFileSync(path.join(dir, 'electron/update-verify.js'), 'utf8'), source)
  assert.throws(() => services.assertExternalFile(dir, path.join(dir, 'keys/private-update.pem')), /HORS/)
  if (process.platform !== 'win32') {
    fs.symlinkSync(dir, path.join(base, 'looks-external'))
    assert.throws(() => services.assertExternalFile(dir, path.join(base, 'looks-external/private.pem')), /HORS/)
  }
})
test('bootstrap admin license has a real P-256 signature and correct record MAC, no shared password', () => {
  const pair = ecPair(), mac = crypto.randomBytes(32).toString('hex')
  const record = services.buildAdminLicense(pair.privateKey, mac, 1800000000)
  const [prefix, header, body, signature] = record.token.split('.')
  assert.equal(prefix, 'GF2')
  const claims = JSON.parse(Buffer.from(body, 'base64url'))
  assert.equal(claims.typ, 'admin')
  assert.equal(claims.lid, record.licenseId)
  assert.equal(record.expiryAt.getTime(), claims.exp * 1000)
  assert.ok(crypto.verify('sha256', Buffer.from(`${header}.${body}`), pair.publicKey, Buffer.from(signature, 'base64url')))
  const expected = crypto.createHmac('sha256', mac).update([record.licenseId, record.token, 'active', record.expiryAt.toISOString(), ''].join('\x00')).digest('hex')
  assert.equal(record.recordMac, expected)
})
test('Vercel filesystem paths and invalid TOTP/old TOTP keys fail validation', () => {
  const env = { GF_BACKUP_DIR: '/tmp/backups', GF_PHOTOS_DIR: '/tmp/photos', GF_TOTP_ENC_KEY: 'wrong', GF_TOTP_ENC_KEY_OLD: 'wrong' }
  const errors = core.validate(env, 'pwa', { vercel: true })
  assert.ok(errors.some(e => e.startsWith('GF_BACKUP_DIR')))
  assert.ok(errors.some(e => e.startsWith('GF_TOTP_ENC_KEY :')))
  assert.ok(errors.some(e => e.startsWith('GF_TOTP_ENC_KEY_OLD')))
})

function fullFixture(t, { existing = false, failMigration = false } = {}) {
  const dir = tmp(t), pair = ecPair()
  copy(dir, ['scripts/garageflow-env-manifest.json', 'scripts/compromised-secrets.json'])
  installPublic(dir, pair.publicKey)
  fs.mkdirSync(path.join(dir, 'node_modules/prisma/build'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules/next'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules/prisma/build/index.js'), '// simulated CLI')
  fs.writeFileSync(path.join(dir, 'node_modules/next/package.json'), '{}')
  const p = policy.loadPolicy(dir)
  const env = core.fillMissing({ DATABASE_URL: 'postgresql://u:pass@ep-test-pooler.neon.tech/db', DIRECT_URL: 'postgresql://u:pass@ep-test.neon.tech/db', NEXTAUTH_URL: 'https://app.test.invalid', GF_APP_URL: 'https://app.test.invalid', UPSTASH_REDIS_REST_URL: 'https://redis.test.invalid', UPSTASH_REDIS_REST_TOKEN: 'test-only-redis-token', GF_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64') }, p.names, 'licences')
  const calls = [], questions = []
  const api = {
    root: dir, publisherFile: path.join(path.dirname(dir), `${path.basename(dir)}-nonexistent-key.pem`), npmCli: () => 'npm-cli.js',
    question: async label => {
      questions.push(label)
      if (label.includes('AUTORISER')) return 'AUTORISER'
      if (label.includes('Base utilisée')) return 'MIGRER'
      return '' // no publisher key supplied, do not silently create a new update authority
    },
    yes: async label => { questions.push(label); return !label.includes('défauts PUBLICS') && !label.includes('première licence') },
    setupVercel: async () => ({ values: env, hidden: new Set(), present: new Set(Object.keys(env)), stamps: {} }),
    importRemote: async (local, _remote, selected) => ({ ...local, ...Object.fromEntries(selected.filter(n => env[n]).map(n => [n, env[n]])) }),
    configureNeon: async () => { throw new Error('Existing database should be reused') },
    secretField: async () => {}, licenseKey: async () => { throw new Error('Existing key should be reused') },
    advanced: async () => { throw new Error('No invalid values expected') },
    execute: async args => { calls.push(args.join(' ')); if (failMigration && args.includes('deploy') && args.includes('migrate')) throw new Error('Simulated migration failure') },
    childEnv: selected => selected,
    syncVercel: async (_env, _names, _remote, options) => { assert.equal(options.authorized, true); calls.push('sync'); return true },
    tool: async (_tool, args) => { calls.push(args.join(' ')); if (args[0] === 'deploy') return 'https://test-deployment.vercel.app'; return '{"status":"ok"}' },
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
    audit: () => ({ policy: p, files: 1200, textFiles: 1150, binaries: 50, codeFiles: 900, apiRoutes: 100, prismaModels: 50, postgresMigrations: 21, directories: {}, references: new Map() }),
    services: { ...services, inspectDatabase: async () => ({ empty: !existing, tableCount: 0 }), testRedis: async () => {}, inspectDesktop: async () => ({ empty: true, tableCount: 0 }), ensureDesktopDatabase: () => 'simulated', run: async () => '' },
  }
  return { dir, api, env, calls, questions }
}
test('full plan runs SQL before deployment, saves correct destinations, reports unresolved external limitations honestly', async t => {
  const f = fullFixture(t)
  await full(f.api)
  const report = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8'))
  assert.equal(report.status, 'configured-with-external-actions')
  assert.ok(report.steps.every(s => s.status === 'done'))
  assert.ok(report.pending.some(s => s.id === 'persistent-backups'))
  assert.ok(report.pending.some(s => s.id === 'publisher-key'))
  assert.ok(report.pending.some(s => s.id === 'admin-access'))
  const sql = f.calls.findIndex(s => s.includes('migrate deploy'))
  const deploy = f.calls.findIndex(s => s === 'deploy --prod --yes')
  assert.ok(sql >= 0 && deploy > sql)
  assert.ok(f.calls.some(s => s.includes('migrate diff') && s.includes('--exit-code')))
  const server = core.readEnv(path.join(f.dir, '.env.server.local'))
  const desktop = core.readEnv(path.join(f.dir, '.env'))
  assert.equal(server.NEXTAUTH_SECRET, f.env.NEXTAUTH_SECRET)
  assert.notEqual(desktop.NEXTAUTH_SECRET, f.env.NEXTAUTH_SECRET)
  assert.ok(!desktop.GF_PRIVATE_KEY)
  assert.equal(desktop.GF_LICENSE_SERVER, f.env.NEXTAUTH_URL)
  assert.equal(desktop.DATABASE_URL, 'file:./dev.db')
  assert.equal(server.EINVOICING_ENABLED, 'false')
  assert.equal(Buffer.from(server.GF_EINVOICE_CREDENTIALS_KEY, 'base64').length, 32)
  assert.ok(!JSON.stringify(report).includes(server.NEXTAUTH_SECRET))
  assert.ok(!fs.existsSync(path.join(f.dir, 'GarageFlow-configuration/config.lock')))
})
test('migration failure prevents cloud synchronization/deployment and leaves a truthful resumable report', async t => {
  const f = fullFixture(t, { existing: true, failMigration: true })
  await assert.rejects(() => full(f.api), /Simulated migration failure/)
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!f.calls.includes('deploy --prod --yes'))
  const report = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8'))
  assert.equal(report.status, 'interrupted')
  assert.equal(report.steps.at(-1).status, 'failed')
  assert.ok(fs.existsSync(path.join(f.dir, '.env.server.local')))
  assert.ok(!fs.existsSync(path.join(f.dir, 'GarageFlow-configuration/config.lock')))
})
test('full plan has no side effects without initial authorization', async t => {
  const f = fullFixture(t)
  f.api.question = async () => ''
  await full(f.api)
  assert.equal(f.calls.length, 0)
  assert.ok(!fs.existsSync(path.join(f.dir, 'GarageFlow-configuration')))
})

test('existing DB missing a critical encryption key cannot silently regenerate or deploy', async t => {
  const f = fullFixture(t, { existing: true })
  delete f.env.GF_TOTP_ENC_KEY
  await assert.rejects(() => full(f.api), /GF_TOTP_ENC_KEY : original nécessaire/)
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!f.calls.includes('deploy --prod --yes'))
  assert.ok(!fs.existsSync(path.join(f.dir, '.env.server.local')))
})
test('existing signature/portal fallback preserves the original session key instead of invalidating proofs and links', async t => {
  const f = fullFixture(t, { existing: true })
  delete f.env.GF_PORTAL_SECRET
  delete f.env.GF_SIGNATURE_SECRET
  await full(f.api)
  const saved = core.readEnv(path.join(f.dir, '.env.server.local'))
  assert.equal(saved.GF_PORTAL_SECRET, f.env.NEXTAUTH_SECRET)
  assert.equal(saved.GF_SIGNATURE_SECRET, f.env.NEXTAUTH_SECRET)
})
test('keygen retains the encryption of an existing private PEM after masked passphrase authorization', t => {
  const dir = tmp(t), pair = ecPair(), passphrase = 'fixture-only-passphrase'
  const key = crypto.createPrivateKey(pair.privateKey)
  const encrypted = key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }).toString()
  installPublic(dir, pair.publicKey)
  core.writePrivate(path.join(dir, 'keys/private.pem'), encrypted)
  const env = { GF_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64'), NEXTAUTH_URL: 'https://app.test.invalid', GARAGEFLOW_API_KEY: crypto.randomBytes(32).toString('hex') }
  services.configureKeygen(dir, env, { privatePassphrase: passphrase })
  assert.equal(fs.readFileSync(path.join(dir, 'keys/private.pem'), 'utf8'), encrypted)
  assert.throws(() => services.configureKeygen(dir, env, { privatePassphrase: 'wrong' }), /passphrase/)
})

test('pooled/direct pair must target the same database/schema and Neon branch', () => {
  const good = { DATABASE_URL: 'postgresql://u:pass@ep-main-pooler.neon.tech/db?schema=custom', DIRECT_URL: 'postgresql://admin:pass@ep-main.neon.tech/db?schema=custom' }
  const connectionErrors = env => core.validate(env, 'pwa', { vercel: true }).filter(e => e.startsWith('DATABASE_URL') || e.startsWith('DIRECT_URL'))
  assert.deepEqual(connectionErrors(good), [])
  for (const direct of ['postgresql://u:pass@ep-main.neon.tech/other?schema=custom', 'postgresql://u:pass@ep-main.neon.tech/db', 'postgresql://u:pass@ep-wrong.neon.tech/db?schema=custom']) {
    assert.ok(connectionErrors({ ...good, DIRECT_URL: direct }).length)
  }
})

test('cloud preflight refuses desktop/runtime downgrades and public secret names without deleting platform variables', () => {
  policy.assertSafeServerOverrides({ values: { NODE_ENV: 'production' }, present: new Set(['NODE_ENV']) })
  assert.throws(() => policy.assertSafeServerOverrides({ values: {}, present: new Set(['ELECTRON']) }), /ELECTRON/)
  assert.throws(() => policy.assertSafeServerOverrides({ values: { NODE_ENV: 'development' }, present: new Set() }), /NODE_ENV/)
  const name = ['NEXT', 'PUBLIC', 'PRIVATE', 'KEY'].join('_')
  assert.throws(() => policy.assertSafeServerOverrides({ values: {}, present: new Set([name]) }), /secrets publics interdits/)
})

test('SQLite initialization honors the configured filename and never overwrites an existing DB', t => {
  const dir = tmp(t)
  fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prisma/garageflow-template.db'), 'fixture-template-bytes')
  assert.equal(services.ensureDesktopDatabase(dir, 'file:./custom.db'), 'created-from-template')
  const file = path.join(dir, 'prisma/custom.db')
  assert.equal(fs.readFileSync(file, 'utf8'), 'fixture-template-bytes')
  fs.writeFileSync(file, 'existing-private-records')
  assert.equal(services.ensureDesktopDatabase(dir, 'file:./custom.db'), 'existing-preserved')
  assert.equal(fs.readFileSync(file, 'utf8'), 'existing-private-records')
  assert.throws(() => services.ensureDesktopDatabase(dir, 'file:../.git/new.db'), /Git interdit/)
})

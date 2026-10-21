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
  const issuer = p.manifest.variables.find(v => v.name === 'GF_PRIVATE_KEY')
  assert.equal(issuer.autoGenerate, false, 'Generic/reset tools must not create or rotate issuer keys')
  assert.equal(issuer.autoManage, false)
  assert.ok(!core.GENERATED.GF_PRIVATE_KEY && !core.GENERATED.GF_UPDATE_SIGNING_KEY)
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
  const env = core.fillMissing({ DATABASE_URL: 'postgresql://u:pass@ep-test-pooler.neon.tech/db', DIRECT_URL: 'postgresql://u:pass@ep-test.neon.tech/db', NEXTAUTH_URL: services.DEFAULT_SERVER_URL, GF_APP_URL: services.DEFAULT_SERVER_URL, UPSTASH_REDIS_REST_URL: 'https://redis.test.invalid', UPSTASH_REDIS_REST_TOKEN: 'test-only-redis-token', GF_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64') }, p.names, 'licences')
  const calls = [], questions = []
  const api = {
    root: dir, publisherFile: path.join(path.dirname(dir), `${path.basename(dir)}-nonexistent-key.pem`), npmCli: () => 'npm-cli.js',
    question: async label => {
      questions.push(label)
      if (label.includes('AUTORISER')) return 'AUTORISER'
      if (label.includes('Base utilisée')) return 'MIGRER'
      return '' // no publisher key supplied, do not silently create a new update authority
    },
    yes: async label => { questions.push(label); return !label.includes('défauts PUBLICS') && !label.includes('première licence') && !label.includes('Personnaliser les variables') },
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
  const ui = JSON.parse(fs.readFileSync(path.join(f.dir, 'keys/server_config.json'), 'utf8'))
  assert.equal(ui.url, 'https://garageflows.fr')
  assert.equal(ui.api_key, f.env.GARAGEFLOW_API_KEY)
  assert.equal(server.GARAGEFLOW_API_KEY, ui.api_key)
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
  const saved = core.readEnv(path.join(f.dir, '.env.server.local'))
  assert.equal(saved.DATABASE_URL, f.env.DATABASE_URL)
  assert.equal(saved.DIRECT_URL, f.env.DIRECT_URL)
  assert.ok(!saved.GF_TOTP_ENC_KEY && !saved.NEXTAUTH_SECRET && !saved.GARAGEFLOW_API_KEY)
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

test('SQL drift and technical comparison failures both stop before cloud mutations', async t => {
  for (const code of [1, 2]) {
    const f = fullFixture(t), execute = f.api.execute
    f.api.execute = async (args, options) => {
      if (args.includes('diff')) throw Object.assign(new Error('private provider response'), { exitCode: code })
      return execute(args, options)
    }
    await assert.rejects(() => full(f.api), code === 2 ? /Drift SQL détecté/ : /Comparaison SQL impossible/)
    assert.ok(!f.calls.includes('sync'))
    assert.ok(!f.calls.some(call => call.startsWith('deploy')))
  }
})

test('full config selects garageflows.fr automatically and rejects an unapproved endpoint change', async () => {
  const env = {}
  await services.configureServerEndpoint(env, { yes: () => { throw new Error('fresh setup should not ask for the URL') } })
  assert.equal(env.NEXTAUTH_URL, 'https://garageflows.fr')
  assert.equal(env.GF_APP_URL, 'https://garageflows.fr')
  const original = { NEXTAUTH_URL: 'https://other-server.invalid', GARAGEFLOW_API_KEY: 'existing-key-do-not-rotate' }
  await assert.rejects(() => services.configureServerEndpoint(original, { yes: async () => false }), /Cible serveur différente/)
  assert.equal(original.NEXTAUTH_URL, 'https://other-server.invalid')
  await services.configureServerEndpoint(original, { yes: async () => true })
  assert.equal(original.NEXTAUTH_URL, 'https://garageflows.fr')
  assert.equal(original.GARAGEFLOW_API_KEY, 'existing-key-do-not-rotate')
})

test('node config writes one server API key and garageflows.fr to the Python UI config, Vercel plan and server profile without rerun rotation', async t => {
  const f = fullFixture(t)
  delete f.env.GARAGEFLOW_API_KEY
  delete f.env.NEXTAUTH_URL
  delete f.env.GF_APP_URL
  const sync = f.api.syncVercel
  const keys = []
  f.api.syncVercel = async (env, ...args) => {
    const ui = JSON.parse(fs.readFileSync(path.join(f.dir, 'keys/server_config.json'), 'utf8'))
    assert.equal(ui.url, 'https://garageflows.fr')
    assert.equal(ui.api_key, env.GARAGEFLOW_API_KEY)
    assert.equal(core.readEnv(path.join(f.dir, '.env.server.local')).GARAGEFLOW_API_KEY, ui.api_key)
    assert.equal(env.NEXTAUTH_URL, 'https://garageflows.fr')
    assert.ok(ui.api_key.length >= 32)
    keys.push(ui.api_key)
    return sync(env, ...args)
  }
  await full(f.api)
  await full(f.api)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1], 'rerun must preserve the existing server API key')
  const python = fs.readFileSync(path.join(root, 'scripts/keygen_db.py'), 'utf8')
  assert.ok(python.includes('ROOT_DIR / "keys" / "server_config.json"'))
  // L'écran « Paramètres et serveur » lie les mêmes clés via tk.StringVar.
  const ui = fs.readFileSync(path.join(root, 'scripts/keygen_ui.py'), 'utf8')
  assert.ok(ui.includes('cfg.get("url")'), 'URL serveur non lue depuis server_config.json')
  assert.ok(ui.includes('cfg.get("api_key")'), 'clé API non lue depuis server_config.json')
})

test('JobPart snapshots stay mandatory and the corrective migration drops only their historical defaults', () => {
  for (const schema of ['prisma/schema.prisma', 'prisma/server/schema.prisma']) {
    const model = fs.readFileSync(path.join(root, schema), 'utf8').match(/model JobPart\s*\{([\s\S]*?)\n\}/)[1]
    for (const column of ['unitPriceTenThousandths', 'unitCostTenThousandths']) {
      const line = model.split('\n').find(line => line.includes(column))
      assert.match(line, /\sInt\s/)
      assert.ok(!line.includes('@default'), 'snapshots must be explicitly supplied by callers')
    }
  }
  const sql = fs.readFileSync(path.join(root, 'prisma/server/migrations/20261014000000_jobpart_snapshot_defaults/migration.sql'), 'utf8')
  for (const column of ['unitPriceTenThousandths', 'unitCostTenThousandths']) {
    assert.match(sql, new RegExp(`ALTER COLUMN "${column}" DROP DEFAULT`))
  }
  const statements = sql.replace(/--[^\n]*/g, '').trim()
  assert.ok(!/DROP\s+(TABLE|COLUMN)|UPDATE|DELETE|TRUNCATE|TYPE|DROP NOT NULL/i.test(statements))
})

test('license import automatically uses the repo keys/private.pem path and verifies identity before assignment', async t => {
  const dir = tmp(t), pair = ecPair()
  installPublic(dir, pair.publicKey)
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true })
  const file = path.join(dir, 'keys/private.pem')
  fs.writeFileSync(file, pair.privateKey)
  const env = {}, wizard = require('../config')
  const noPrompt = async () => { throw new Error('automatic key discovery must not ask for source/path') }
  await wizard.licenseKey(env, { root: dir, choose: noPrompt, prompt: noPrompt })
  assert.equal(Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString(), pair.privateKey)
  assert.equal(fs.readFileSync(file, 'utf8'), pair.privateKey)
  assert.ok(core.licenseKeyMatches(env.GF_PRIVATE_KEY, pair.publicKey))
  fs.writeFileSync(file, ecPair().privateKey)
  const wrong = {}
  await assert.rejects(() => wizard.licenseKey(wrong, { root: dir, choose: noPrompt, prompt: noPrompt }), /Clé privée différente/)
  assert.ok(!wrong.GF_PRIVATE_KEY)
})

test('manual original-key import proposes the exact repo path and accepts quoted Windows-style pasted paths', async t => {
  const dir = tmp(t), pair = ecPair(), wizard = require('../config'), env = {}
  installPublic(dir, pair.publicKey)
  const file = path.join(dir, 'keys/private.pem')
  await wizard.licenseKey(env, { root: dir,
    choose: async (_label, items) => items[0],
    prompt: async (_label, options) => {
      assert.equal(options.defaultValue, file)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, pair.privateKey)
      return `"${file}"`
    },
  })
  assert.equal(Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString(), pair.privateKey)
})

test('full wizard offers optional server and desktop variables and saves chosen values in their own profiles', async t => {
  const f = fullFixture(t), oldYes = f.api.yes, edits = []
  f.api.yes = async label => label.includes('Personnaliser les variables') || oldYes(label)
  f.api.advanced = async (env, selected) => {
    edits.push([...selected])
    if (selected.includes('RATE_LIMIT_LOGIN_MAX')) {
      env.RATE_LIMIT_LOGIN_MAX = '12'
      env.GF_MIN_PWA_VERSION = '1.2.3'
    } else {
      env.GF_UPDATE_CHANNEL = 'beta'
    }
  }
  await full(f.api)
  assert.equal(edits.length, 2)
  const server = core.readEnv(path.join(f.dir, '.env.server.local'))
  const desktop = core.readEnv(path.join(f.dir, '.env'))
  assert.equal(server.RATE_LIMIT_LOGIN_MAX, '12')
  assert.equal(server.GF_MIN_PWA_VERSION, '1.2.3')
  assert.equal(desktop.GF_UPDATE_CHANNEL, 'beta')
  assert.ok(!desktop.RATE_LIMIT_LOGIN_MAX && !server.GF_UPDATE_CHANNEL)
})

test('optional database edits are inspected before missing keys are generated or migrations authorized', async t => {
  const f = fullFixture(t), oldYes = f.api.yes
  const direct = 'postgresql://u:pass@ep-selected.neon.tech/db'
  f.api.yes = async label => label.includes('Personnaliser les variables facultatives du serveur') || oldYes(label)
  f.api.advanced = async env => {
    env.DATABASE_URL = 'postgresql://u:pass@ep-selected-pooler.neon.tech/db'
    env.DIRECT_URL = direct
  }
  let inspected = false
  f.api.services.inspectDatabase = async (_root, url) => { assert.equal(url, direct); inspected = true; return { empty: true } }
  await full(f.api)
  assert.equal(inspected, true)
  assert.equal(core.readEnv(path.join(f.dir, '.env.server.local')).DIRECT_URL, direct)
})

test('validation corrections cannot silently switch databases after the data-preservation inspection', async t => {
  const f = fullFixture(t)
  f.env.GF_MIN_PWA_VERSION = 'invalid'
  f.api.advanced = async env => {
    env.GF_MIN_PWA_VERSION = '1.2.3'
    env.DATABASE_URL = 'postgresql://u:pass@ep-other-pooler.neon.tech/db'
    env.DIRECT_URL = 'postgresql://u:pass@ep-other.neon.tech/db'
  }
  await assert.rejects(() => full(f.api), /DATABASE_URL : cible modifiée après inspection/)
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!f.calls.some(c => c.includes('migrate deploy')))
})

test('known compromised secrets remain blocked after advanced validation corrections', async t => {
  const f = fullFixture(t), compromised = crypto.randomBytes(32).toString('base64')
  fs.writeFileSync(path.join(f.dir, 'scripts/compromised-secrets.json'), JSON.stringify({ entries: [{ env: 'NEXTAUTH_SECRET', sha256Prefix: crypto.createHash('sha256').update(compromised).digest('hex') }] }))
  f.env.GF_MIN_PWA_VERSION = 'invalid'
  f.api.advanced = async env => { env.GF_MIN_PWA_VERSION = '1.2.3'; env.NEXTAUTH_SECRET = compromised }
  await assert.rejects(() => full(f.api), /NEXTAUTH_SECRET : empreinte connue compromise/)
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!f.calls.some(c => c.includes('migrate deploy')))
})

function automaticKeyFixture(t) {
  const dir = tmp(t)
  copy(dir, ['scripts/sync-public-key.mjs', 'scripts/check-critical-files.js', 'electron/main.js',
    'src/lib/license/public-key.ts', 'src/lib/license/__tests__/public-key-consistency.test.ts'])
  return dir
}
async function realKeySync(args) {
  const result = require('node:child_process').spawnSync(process.execPath, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, 'Real public-key synchronization must succeed; raw output suppressed')
}
const unexpectedKeyPrompt = async () => { throw new Error('Automatic first installation must not request a key value or source') }

test('fresh authority generates, saves and synchronizes real P-256 keys without asking for values; rerun reuses them', async t => {
  const dir = automaticKeyFixture(t), wizard = require('../config'), env = {}
  await wizard.licenseKey(env, { root: dir, autoCreate: true, choose: unexpectedKeyPrompt, prompt: unexpectedKeyPrompt, run: realKeySync })
  const privateFile = path.join(dir, 'keys/private.pem'), publicFile = path.join(dir, 'keys/public.pem')
  const pem = fs.readFileSync(privateFile, 'utf8'), pub = fs.readFileSync(publicFile, 'utf8')
  const key = crypto.createPrivateKey(pem)
  assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1')
  assert.equal(Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString(), pem)
  assert.ok(core.licenseKeyMatches(env.GF_PRIVATE_KEY, core.embeddedLicenseKey(dir)))
  const data = Buffer.from('isolated-generated-license-proof')
  assert.ok(crypto.verify('sha256', data, pub, crypto.sign('sha256', data, pem)))
  const state = require('../scripts/config-keys.cjs').readState(dir)
  assert.equal(state.autoGenerated, true)
  assert.equal(state.licensePublicFingerprint, services.publicFingerprint(pub))
  assert.ok(!JSON.stringify(state).includes(pem))
  const second = {}
  await wizard.licenseKey(second, { root: dir, autoCreate: true, choose: unexpectedKeyPrompt, prompt: unexpectedKeyPrompt, run: realKeySync })
  assert.equal(second.GF_PRIVATE_KEY, env.GF_PRIVATE_KEY)
  assert.equal(fs.readFileSync(privateFile, 'utf8'), pem)
})

test('automatic generation refuses lost originals indicated by an existing public key or issuer config', async t => {
  const wizard = require('../config')
  for (const file of ['keys/public.pem', 'keys/server_config.json']) {
    const dir = automaticKeyFixture(t), marker = file.endsWith('.pem') ? ecPair().publicKey : '{}'
    fs.mkdirSync(path.join(dir, 'keys'), { recursive: true }); fs.writeFileSync(path.join(dir, file), marker)
    await assert.rejects(() => wizard.licenseKey({}, { root: dir, autoCreate: true, choose: unexpectedKeyPrompt, prompt: unexpectedKeyPrompt, run: unexpectedKeyPrompt }), /clé privée ORIGINALE/)
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), marker)
    assert.ok(!fs.existsSync(path.join(dir, 'keys/private.pem')))
  }
})

test('interrupted first public synchronization resumes using the exact saved private key', async t => {
  const dir = automaticKeyFixture(t), wizard = require('../config')
  await assert.rejects(() => wizard.licenseKey({}, { root: dir, autoCreate: true, run: async () => { throw new Error('Simulated sync interruption') } }), /sync interruption/)
  const original = fs.readFileSync(path.join(dir, 'keys/private.pem'), 'utf8'), env = {}
  await wizard.licenseKey(env, { root: dir, autoCreate: true, choose: unexpectedKeyPrompt, prompt: unexpectedKeyPrompt, run: realKeySync })
  assert.equal(fs.readFileSync(path.join(dir, 'keys/private.pem'), 'utf8'), original)
  assert.equal(Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString(), original)
  assert.ok(core.licenseKeyMatches(env.GF_PRIVATE_KEY, core.embeddedLicenseKey(dir)))
})

test('missing or different private key after recorded creation never triggers automatic regeneration', async t => {
  const dir = automaticKeyFixture(t), wizard = require('../config')
  await wizard.licenseKey({}, { root: dir, autoCreate: true, run: realKeySync })
  const file = path.join(dir, 'keys/private.pem'), original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, ecPair().privateKey)
  await assert.rejects(() => wizard.licenseKey({}, { root: dir, autoCreate: true, run: unexpectedKeyPrompt }), /différente du reçu/)
  fs.unlinkSync(file) // Owned disposable fixture only; simulates a missing original.
  await assert.rejects(() => wizard.licenseKey({}, { root: dir, autoCreate: true, run: unexpectedKeyPrompt }), /clé privée ORIGINALE/)
  assert.ok(!fs.existsSync(file))
  assert.ok(original.length > 0)
})

function automaticFullFixture(t, { failMigration = false } = {}) {
  const f = fullFixture(t, { failMigration }), wizard = require('../config'), vault = tmp(t)
  copy(f.dir, ['scripts/sync-public-key.mjs', 'scripts/check-critical-files.js', 'electron/main.js',
    'src/lib/license/public-key.ts', 'src/lib/license/__tests__/public-key-consistency.test.ts',
    'electron/update-verify.js', 'electron/semver.js'])
  for (const name of [...Object.keys(core.GENERATED), 'GF_PRIVATE_KEY', 'GF_EINVOICE_CREDENTIALS_KEY']) delete f.env[name]
  f.api.publisherFile = path.join(vault, 'new-channel/update.pem')
  f.api.licenseKey = async (env, options) => {
    assert.equal(options.autoCreate, true)
    return wizard.licenseKey(env, { ...options, root: f.dir, choose: unexpectedKeyPrompt, prompt: unexpectedKeyPrompt, run: realKeySync })
  }
  f.api.secretField = async (_env, name) => { assert.equal(name, 'ANTHROPIC_API_KEY', 'Locally generated keys must not request manual values') }
  return f
}

test('default full plan generates and saves every first-install key, API configuration and external signer automatically', async t => {
  const f = automaticFullFixture(t)
  const before = require(path.join(f.dir, 'electron/update-verify.js')).PUBLIC_KEYS
  await full(f.api)
  const server = core.readEnv(path.join(f.dir, '.env.server.local')), desktop = core.readEnv(path.join(f.dir, '.env'))
  const generated = Object.keys(core.GENERATED).filter(n => policy.loadPolicy(f.dir).names.includes(n))
  for (const name of generated) assert.equal(Buffer.from(server[name], core.GENERATED[name]).length, 32, name)
  assert.equal(new Set(generated.map(n => server[n])).size, generated.length)
  assert.equal(Buffer.from(server.GF_EINVOICE_CREDENTIALS_KEY, 'base64').length, 32)
  assert.equal(server.EINVOICING_ENABLED, 'false')
  for (const name of ['GF_BACKUP_KEY', 'GF_SMTP_CIPHER_KEY', 'GF_TOTP_ENC_KEY', 'GF_EINVOICE_CREDENTIALS_KEY']) {
    const key = Buffer.from(server[name], 'base64'), iv = crypto.randomBytes(12), proof = Buffer.from('isolated-cipher-proof')
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(proof), cipher.final()])
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    decipher.setAuthTag(cipher.getAuthTag())
    assert.deepEqual(Buffer.concat([decipher.update(ciphertext), decipher.final()]), proof)
  }
  assert.equal(crypto.createHmac('sha256', server.GF_DB_MAC_SECRET).update('isolated-mac-proof').digest('hex').length, 64)
  assert.equal(server.GF_SMTP_CIPHER_KEY_OLD, undefined)
  assert.notEqual(desktop.NEXTAUTH_SECRET, server.NEXTAUTH_SECRET)
  assert.equal(desktop.GF_PRIVATE_KEY, undefined)
  const signer = fs.readFileSync(f.api.publisherFile, 'utf8')
  assert.equal(crypto.createPrivateKey(signer).asymmetricKeyType, 'ed25519')
  const cfg = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/publisher.json'), 'utf8'))
  assert.equal(cfg.keyFile, f.api.publisherFile)
  assert.ok(crypto.verify(null, Buffer.from('isolated-update-proof'), cfg.publicKey, crypto.sign(null, Buffer.from('isolated-update-proof'), signer)))
  const source = fs.readFileSync(path.join(f.dir, 'electron/update-verify.js'), 'utf8')
  for (const [id, pub] of Object.entries(before)) assert.ok(source.includes(id) && source.includes(pub.split('\n')[1]))
  const keygen = JSON.parse(fs.readFileSync(path.join(f.dir, 'keys/server_config.json'), 'utf8'))
  assert.equal(keygen.api_key, server.GARAGEFLOW_API_KEY)
  assert.equal(keygen.url, 'https://garageflows.fr')
  assert.ok(!f.questions.some(q => /Source de la clé|Chemin du PEM|NOUVEAU-CANAL/.test(q)))
  const report = JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8')))
  for (const name of generated) assert.ok(!report.includes(server[name]))
  assert.ok(!report.includes(signer) && !source.includes(signer))
  Object.assign(f.env, server)
  await full(f.api)
  assert.equal(fs.readFileSync(f.api.publisherFile, 'utf8'), signer)
  assert.equal(core.readEnv(path.join(f.dir, '.env.server.local')).NEXTAUTH_SECRET, server.NEXTAUTH_SECRET)
})

test('an interrupted fresh full plan reuses all saved secrets including the signer on resume', async t => {
  const f = automaticFullFixture(t, { failMigration: true })
  await assert.rejects(() => full(f.api), /Simulated migration failure/)
  const saved = core.readEnv(path.join(f.dir, '.env.server.local'))
  assert.ok(saved.GF_PRIVATE_KEY && saved.NEXTAUTH_SECRET)
  assert.ok(fs.existsSync(f.api.publisherFile))
  const savedSigner = fs.readFileSync(f.api.publisherFile, 'utf8')
  f.api.execute = async args => { f.calls.push(args.join(' ')) }
  await full(f.api)
  const resumed = core.readEnv(path.join(f.dir, '.env.server.local'))
  assert.equal(resumed.GF_PRIVATE_KEY, saved.GF_PRIVATE_KEY)
  assert.equal(resumed.NEXTAUTH_SECRET, saved.NEXTAUTH_SECRET)
  assert.equal(fs.readFileSync(f.api.publisherFile, 'utf8'), savedSigner)
})

test('a lost initialized publisher key is never regenerated by first-install automation', async t => {
  const f = automaticFullFixture(t)
  await full(f.api)
  const state = require('../scripts/config-keys.cjs').readState(f.dir)
  assert.equal(state.publisherInitialized, true)
  fs.unlinkSync(f.api.publisherFile) // Owned fixture; emulate loss, not rotate a real key.
  await full(f.api)
  assert.ok(!fs.existsSync(f.api.publisherFile))
  const report = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8'))
  assert.ok(report.pending.some(p => p.id === 'publisher-key'))
})

test('corrupt public-only creation receipt fails closed without creating keys', t => {
  const dir = tmp(t), keys = require('../scripts/config-keys.cjs')
  fs.mkdirSync(path.join(dir, 'GarageFlow-configuration'))
  fs.writeFileSync(keys.stateFile(dir), '{invalid json')
  assert.throws(() => keys.mayCreatePublisher(dir, ecPair().privateKey, true, false), /Reçu de création/)
  assert.ok(!fs.existsSync(path.join(dir, 'keys/private.pem')))
})

test('used database never receives an automatically generated replacement issuer', async t => {
  const f = fullFixture(t, { existing: true })
  delete f.env.GF_PRIVATE_KEY
  f.api.licenseKey = async (_env, options) => {
    assert.equal(options.autoCreate, false)
    throw new Error('Original issuer required for this used database')
  }
  await assert.rejects(() => full(f.api), /Original issuer required/)
  assert.ok(!fs.existsSync(path.join(f.dir, 'keys/private.pem')))
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!f.calls.some(c => c.includes('migrate deploy')))
})

test('first-install recovery synchronizes all public anchors even when the Next anchor already matches', async t => {
  const dir = automaticKeyFixture(t), wizard = require('../config')
  await wizard.licenseKey({}, { root: dir, autoCreate: true, run: realKeySync })
  const referenceFile = path.join(dir, 'src/lib/license/__tests__/public-key-consistency.test.ts')
  fs.copyFileSync(path.join(root, 'src/lib/license/__tests__/public-key-consistency.test.ts'), referenceFile)
  const nextKeyBefore = core.embeddedLicenseKey(dir), env = {}
  await wizard.licenseKey(env, { root: dir, autoCreate: true, run: realKeySync })
  assert.equal(core.embeddedLicenseKey(dir), nextKeyBefore)
  assert.ok(fs.readFileSync(referenceFile, 'utf8').includes(services.publicFingerprint(nextKeyBefore)))
  assert.ok(core.licenseKeyMatches(env.GF_PRIVATE_KEY, nextKeyBefore))
})

test('automatic keygen reuse preserves an existing unencrypted SEC1 PEM byte for byte', t => {
  const dir = tmp(t), pair = ecPair()
  installPublic(dir, pair.publicKey)
  const original = crypto.createPrivateKey(pair.privateKey).export({ type: 'sec1', format: 'pem' }).toString()
  const file = path.join(dir, 'keys/private.pem')
  core.writePrivate(file, original)
  const env = { GF_PRIVATE_KEY: Buffer.from(pair.privateKey).toString('base64'), NEXTAUTH_URL: 'https://garageflows.fr', GARAGEFLOW_API_KEY: crypto.randomBytes(32).toString('hex') }
  services.configureKeygen(dir, env)
  assert.equal(fs.readFileSync(file, 'utf8'), original)
  assert.equal(services.publicFingerprint(fs.readFileSync(path.join(dir, 'keys/public.pem'))), services.publicFingerprint(original))
})

// ── Clés absentes : génération automatique vs base déjà utilisée ────────────
const { resolveMissingKey } = require('../scripts/config-full.cjs')
test('clé absente sur une base sans données métier : génération automatique, aucune saisie', async () => {
  const calls = []
  const api = { secretField: async () => { throw new Error('aucune saisie ne doit être demandée') }, yes: async () => { throw new Error('aucune confirmation nécessaire') } }
  const env = {}
  assert.equal(await resolveMissingKey(api, env, 'GF_TOTP_ENC_KEY', { used: false }), 'generated')
  assert.equal(Buffer.from(env.GF_TOTP_ENC_KEY, 'base64').length, 32)
  calls.length = 0
})
test('clé absente sur une base utilisée : original, NONUTILISE ou GENERER sans jamais écraser en silence', async () => {
  const answers = { GF_TOTP_ENC_KEY: 'valeur-originale-du-coffre' }
  const env = {}
  const api = { secretField: async (target, name) => { target[name] = answers[name] }, yes: async () => true }
  assert.equal(await resolveMissingKey(api, env, 'GF_TOTP_ENC_KEY', { used: true }), 'imported')
  assert.equal(env.GF_TOTP_ENC_KEY, 'valeur-originale-du-coffre')
  const declared = { GF_BACKUP_KEY: core.KEY_PROMPT_COMMANDS.declaredUnused }
  const env2 = {}
  const api2 = { secretField: async (target, name) => { target[name] = declared[name] }, yes: async () => true }
  assert.equal(await resolveMissingKey(api2, env2, 'GF_BACKUP_KEY', { used: true }), 'declared-unused')
  assert.equal(env2.GF_BACKUP_KEY, undefined, 'la déclaration sera suivie d’une génération, pas d’une valeur importée')
  const generated = { GF_SIGNATURE_SECRET: core.KEY_PROMPT_COMMANDS.generate }
  const env3 = {}
  const api3 = { secretField: async (target, name) => { target[name] = generated[name] }, yes: async () => true }
  assert.equal(await resolveMissingKey(api3, env3, 'GF_SIGNATURE_SECRET', { used: true }), 'generated')
  assert.equal(Buffer.from(env3.GF_SIGNATURE_SECRET, 'base64').length, 32)
  const refused = { GF_SMTP_CIPHER_KEY: core.KEY_PROMPT_COMMANDS.generate }
  const api4 = { secretField: async (target, name) => { target[name] = refused[name] }, yes: async () => false }
  await assert.rejects(() => resolveMissingKey(api4, {}, 'GF_SMTP_CIPHER_KEY', { used: true }), /original nécessaire/)
  const empty = {}
  const api5 = { secretField: async () => {}, yes: async () => true }
  await assert.rejects(() => resolveMissingKey(api5, empty, 'GF_TOTP_ENC_KEY', { used: true }), /GF_TOTP_ENC_KEY : original nécessaire/)
  assert.ok(!empty.GF_TOTP_ENC_KEY, 'aucune clé générée quand rien n’est fourni pour une base utilisée')
})

test('une SQLite sans données métier (registres ignorés) reçoit toutes ses clés desktop sans saisie', async t => {
  const f = fullFixture(t)
  const asked = []
  // Aucune valeur de clé chez Vercel ni sur le poste : tout doit être généré, des deux côtés.
  delete f.env.NEXTAUTH_SECRET
  delete f.env.GF_TOTP_ENC_KEY
  f.api.secretField = async (_env, name) => { asked.push(name); if (name !== 'ANTHROPIC_API_KEY') throw new Error(`Aucune valeur de clé ne doit être demandée (${name})`) }
  f.api.services.inspectDesktop = async () => ({ empty: true, tableCount: 43, ignored: 1 })
  await full(f.api)
  const desktopNames = core.namesForProfile(policy.loadPolicy(f.dir).names, 'desktop')
  const desktop = core.readEnv(path.join(f.dir, '.env'))
  const server = core.readEnv(path.join(f.dir, '.env.server.local'))
  for (const name of Object.keys(core.GENERATED)) {
    if (!desktopNames.includes(name)) continue
    assert.equal(Buffer.from(desktop[name], core.GENERATED[name]).length, 32, name)
    assert.notEqual(desktop[name], server[name], `${name} desktop reste distinct du serveur`)
  }
  assert.deepEqual(asked, ['ANTHROPIC_API_KEY'])
  assert.ok(!f.questions.some(q => /ORIGINALE|NONUTILISE/.test(q)))
  assert.ok(f.calls.includes('sync'))
  const report = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8'))
  assert.equal(report.status, 'configured-with-external-actions')
  for (const [name, scope] of [['NEXTAUTH_SECRET', 'desktop'], ['NEXTAUTH_SECRET', 'serveur'], ['GF_TOTP_ENC_KEY', 'serveur']]) {
    assert.ok(report.keys.some(k => k.name === name && k.scope === scope), `${name} (${scope}) doit apparaître dans le récapitulatif`)
  }
  assert.equal(server.NEXTAUTH_SECRET.length >= 32, true)
  assert.notEqual(server.NEXTAUTH_SECRET, desktop.NEXTAUTH_SECRET)
  assert.ok(!JSON.stringify(report).includes(desktop.NEXTAUTH_SECRET))
})

test('une SQLite déjà utilisée accepte GENERER clé par clé et écrit les valeurs dans .env', async t => {
  const f = fullFixture(t, { existing: true })
  const answered = new Set()
  f.api.secretField = async (env, name) => {
    if (name === 'ANTHROPIC_API_KEY') return
    assert.ok(answered.add(name), `une seule demande par clé (${name})`)
    env[name] = core.KEY_PROMPT_COMMANDS.generate
  }
  f.api.services.inspectDesktop = async () => ({ empty: false, tableCount: 43, ignored: 1 })
  await full(f.api)
  const desktopNames = core.namesForProfile(policy.loadPolicy(f.dir).names, 'desktop')
  const desktop = core.readEnv(path.join(f.dir, '.env'))
  assert.ok(answered.size >= 4, 'chaque clé desktop absente a été traitée')
  for (const name of Object.keys(core.GENERATED)) {
    if (!desktopNames.includes(name)) continue
    assert.equal(Buffer.from(desktop[name], core.GENERATED[name]).length, 32, name)
  }
  assert.ok(f.questions.some(q => q.includes('Confirmer la génération d’une NOUVELLE valeur pour NEXTAUTH_SECRET')))
})

test('refuser la confirmation GENERER arrête le plan sans écrire de clé de remplacement', async t => {
  const f = fullFixture(t, { existing: true })
  const oldYes = f.api.yes
  f.api.yes = async label => label.includes('Confirmer la génération') ? false : oldYes(label)
  f.api.secretField = async (env, name) => { if (name !== 'ANTHROPIC_API_KEY') env[name] = core.KEY_PROMPT_COMMANDS.generate }
  f.api.services.inspectDesktop = async () => ({ empty: false, tableCount: 43, ignored: 1 })
  await assert.rejects(() => full(f.api), /original nécessaire/)
  assert.ok(!f.calls.includes('sync'))
  assert.ok(!fs.existsSync(path.join(f.dir, '.env')))
})

for (const existing of [false, true]) {
  test(`secret Vercel illisible différé : inspection SQL avant résolution (base ${existing ? 'utilisée' : 'vide'})`, async t => {
    const f = fullFixture(t, { existing })
    const name = 'GF_PORTAL_SECRET'
    const baseImport = f.api.importRemote
    const baseSetup = f.api.setupVercel
    const events = []
    f.api.setupVercel = async () => {
      const remote = await baseSetup()
      remote.values = { ...remote.values }
      delete remote.values[name]
      remote.hidden.add(name)
      return remote
    }
    f.api.services.inspectDatabase = async () => {
      events.push('SQL')
      return { empty: !existing, tableCount: 0 }
    }
    f.api.importRemote = async (local, remote, names, options) => {
      if (options.deferGenerated) {
        events.push('différé')
        remote.deferredGenerated = new Set([name])
        const result = await baseImport(local, remote, names)
        delete result[name]
        return result
      }
      events.push('résolution')
      assert.deepEqual(events, ['différé', 'SQL', 'résolution'])
      assert.deepEqual(names, [name])
      assert.equal(options.rotationAutorisee, !existing)
      if (existing) throw new Error('Accord explicite requis pour la base utilisée')
      remote.generatedHere = new Set([name])
      return { ...local, [name]: f.env[name] }
    }
    if (existing) {
      await assert.rejects(() => full(f.api), /Accord explicite requis/)
      assert.ok(!f.calls.includes('sync'))
    } else {
      await full(f.api)
      const report = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/report.json'), 'utf8'))
      assert.ok(report.keys.some(k => k.name === name), 'la clé générée doit figurer au récapitulatif')
      assert.equal(core.readEnv(path.join(f.dir, '.env.server.local'))[name], f.env[name])
      assert.ok(f.calls.includes('sync'))
    }
  })
}

test('automatic full plan: one AUTORISER, no manual credential prompts, backups before production rewrite', async t => {
  const f = fullFixture(t)
  copy(f.dir, ['electron/license-endpoint.js', 'electron/main.js', 'electron/update-verify.js', 'src/lib/public-url.ts', 'scripts/sign-release-manifest.mjs'])
  f.api.services.bootstrapAdmin = async () => 'simulated-admin-license-created'
  fs.mkdirSync(path.join(f.dir, '.vercel'))
  fs.writeFileSync(path.join(f.dir, '.vercel/project.json'), JSON.stringify({ orgId: 'team_test', projectId: 'prj_test' }))
  const initial = await f.api.setupVercel()
  let current = { ...initial, values: { ...initial.values }, stamps: Object.fromEntries([...initial.present].map(n => [n, `old-${n}`])), records: [...initial.present].map(key => ({ key })) }
  f.api.setupVercel = async options => { assert.equal(options.authorized, true); return structuredClone(current) }
  f.api.pullVercel = async () => structuredClone(current)
  const oldTool = f.api.tool
  const mutations = []
  f.api.tool = async (tool, args, options = {}) => {
    if (tool === 'vercel' && args[0] === 'env') {
      const [_, command, name, environment] = args
      assert.equal(environment, 'production')
      mutations.push(command)
      const folder = path.join(f.dir, 'GarageFlow-configuration')
      assert.ok(fs.existsSync(path.join(folder, 'rebuild-pending.json')), 'journal before mutation')
      if (command === 'rm') {
        assert.equal(options.input, undefined)
        current.present.delete(name); current.hidden.delete(name); delete current.values[name]; delete current.stamps[name]
        current.records = current.records.filter(r => r.key !== name)
      } else {
        current.present.add(name); current.stamps[name] = `new-${name}`; current.records.push({ key: name })
        if (args.includes('--sensitive')) current.hidden.add(name)
        else current.values[name] = options.input
      }
      return ''
    }
    return oldTool(tool, args, options)
  }
  await full(f.api, { automatic: true })
  assert.equal(f.questions.length, 1)
  assert.match(f.questions[0], /AUTORISER/)
  assert.ok(mutations.includes('rm') && mutations.includes('add'))
  const server = core.readEnv(path.join(f.dir, '.env.server.local'))
  assert.notEqual(server.NEXTAUTH_SECRET, f.env.NEXTAUTH_SECRET)
  assert.equal(server.DATABASE_URL, f.env.DATABASE_URL)
  assert.ok(!current.present.has('GF_INTERNAL_EXPORT_KEY'))
  assert.ok(!current.present.has('GF_UPDATE_CHANNEL'))
  assert.ok(!fs.existsSync(path.join(f.dir, 'GarageFlow-configuration/rebuild-pending.json')))
})

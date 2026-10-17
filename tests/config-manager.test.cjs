'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const core = require('../scripts/config-core.cjs')
const manager = require('../scripts/config-manager.cjs')
const credentials = require('../scripts/lib/config-credentials.cjs')
const cloudModule = require('../scripts/lib/config-cloud.cjs')
const root = path.resolve(__dirname, '..')
const project = { projectId: 'prj_unit', orgId: 'team_unit' }
const policy = require('../scripts/config-policy.cjs').loadPolicy(root)
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-manager-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  for (const file of ['.env.example', 'scripts/garageflow-env-manifest.json', 'scripts/compromised-secrets.json']) fs.copyFileSync(path.join(root, file), path.join(dir, file))
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n!.env.example\nGarageFlow-configuration/\n')
  execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '.gitignore', '.env.example', 'scripts'], { cwd: dir, stdio: 'ignore' })
  const values = {}, snapshots = {}, writes = [], prompts = []
  let seq = 0, connections = 0, probes = 0
  for (const target of cloudModule.TARGETS) {
    values[target] = { ...credentials.neonVariables('fixture-password-not-issued', { user: 'unit_owner', database: 'unit_database', pooled: `ep-${target}-pooler.neon.tech`, direct: `ep-${target}.neon.tech` }),
      NEXTAUTH_URL: `https://${target}.example.invalid`, UPSTASH_REDIS_REST_URL: `https://${target}.upstash.io`,
      UPSTASH_REDIS_REST_TOKEN: `fixture-redis-${target}-not-issued`, BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_UnitTest_fixture-${target}-not-issued` }
    snapshots[target] = { records: [], values: {}, branchOverrides: 0 }
    core.writePrivate(path.join(dir, `.env.storage.${target}.local`), core.serializeEnv(values[target], Object.keys(values[target]), `storage-${target}`))
  }
  const control = { failAt: null, failAfterApply: false, hide: false }
  const driver = {
    connect: async () => { connections++; return project },
    read: async (_project, target) => {
      const result = structuredClone(snapshots[target])
      if (control.hide) for (const r of result.records) if (core.isSecret(r.key)) delete result.values[r.key]
      return result
    },
    recover: async () => {}, ensureClients: async () => {}, blobStores: async () => ['store_UnitTest'],
    probeDatabase: async () => { probes++; return { pooled: true, direct: true, empty: true } },
    probeRedis: async () => true, probeBlob: async () => ({ associated: true, list: true, write: 'not_tested' }),
    write: async (_project, target, operation, options) => {
      assert.equal(options.authorized, true)
      writes.push({ target, key: operation.key, kind: operation.kind })
      const fail = writes.length === control.failAt
      if (fail && !control.failAfterApply) throw new Error('private-provider-secret-error')
      const s = snapshots[target], old = s.records.find(r => r.key === operation.key)
      if (operation.kind === 'remove') {
        assert.equal(old?.id, operation.record.id)
        s.records = s.records.filter(r => r.key !== operation.key); delete s.values[operation.key]
      } else {
        if (operation.kind === 'create') assert.ok(!old, 'no duplicate create')
        else assert.equal(old?.id, operation.record.id)
        const r = { key: operation.key, id: old?.id || `env_${++seq}`, type: operation.type, target: [target], updatedAt: ++seq, ...(operation.ownership || operation.comment !== undefined ? { comment: operation.ownership || operation.comment } : old?.comment !== undefined ? { comment: old.comment } : {}) }
        s.records = [...s.records.filter(r => r.key !== operation.key), r]; s.values[operation.key] = operation.value
      }
      if (fail) throw new Error('private-provider-secret-error')
    },
  }
  const api = { root: dir, question: async label => { prompts.push(label); return 'AUTORISER' },
    yes: async label => { prompts.push(label); return !/tenter la récupération|corriger les accès|Utiliser les hôtes/.test(label) },
    secretField: async (_env, key) => { throw new Error(`Unexpected prompt for ${key}`) } }
  const inventory = () => ({ files: 5, textFiles: 5, binaries: 0, references: new Map([['DATABASE_URL', new Set(['src/lib/db.ts'])]]) })
  const run = options => manager.manage(api, { driver, inventory, ...options })
  return { dir, api, driver, inventory, run, values, snapshots, writes, prompts, control, connections: () => connections, probes: () => probes }
}
function addRecord(f, target, key, value, extra = {}) {
  f.snapshots[target].records.push({ key, id: `env_initial_${key}`, type: 'encrypted', target: [target], updatedAt: 1, ...extra })
  if (value !== undefined) f.snapshots[target].values[key] = value
}
function tree(dir) {
  const result = {}
  function walk(folder, prefix = '') { for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    if (item.name === '.git') continue
    const relative = prefix + item.name
    if (item.isDirectory()) walk(path.join(folder, item.name), relative + '/')
    else result[relative] = { hash: credentials.hash(fs.readFileSync(path.join(folder, item.name))), mode: fs.statSync(path.join(folder, item.name)).mode, mtime: fs.statSync(path.join(folder, item.name)).mtimeMs }
  } }
  walk(dir); return result
}

test('Neon password encoding is exactly once, including %, quotes, unicode, #, @ and ampersands', () => {
  for (const password of ['p%40raw', 'p@ss:/?#&= +', 'test-é-漢字-"\'`']) {
    const values = credentials.neonVariables(password)
    assert.equal(decodeURIComponent(new URL(values.DATABASE_URL).password), password)
    assert.equal(decodeURIComponent(new URL(values.POSTGRES_PRISMA_URL).password), password)
    assert.deepEqual(credentials.postgresIssues(values), [])
    assert.equal(new URL(values.DATABASE_URL).searchParams.get('sslmode'), 'require')
    assert.equal(new URL(values.POSTGRES_URL_NO_SSL).searchParams.has('sslmode'), false)
  }
  const bad = credentials.neonVariables('fixture-password')
  bad.DATABASE_URL = bad.POSTGRES_URL_NO_SSL
  assert.match(credentials.postgresIssues(bad)[0], /SSL/)
})

test('compromised password cannot be reused under an alias, alternate query order, or percent encoding', () => {
  const password = 'fixture-compromised-password', entries = [{ sha256Prefix: credentials.hash(password) }]
  const values = credentials.neonVariables(password)
  assert.equal(credentials.compromised(values.DATABASE_URL + '&connect_timeout=9', entries), true)
  assert.equal(credentials.compromised(values.POSTGRES_URL_NO_SSL, entries), true)
  assert.deepEqual(credentials.cleanCredentials({ arbitraryAlias: password, PGHOST: 'unit.neon.tech' }, entries), { safe: { PGHOST: 'unit.neon.tech' }, rejected: ['arbitraryAlias'] })
  assert.equal(credentials.compromised('fresh-fixture-value', entries), false)
})

test('real manager orchestration synchronizes three separate environments, then makes ZERO repeat mutations', async t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.dir, '.env'), 'DATABASE_URL="file:./desktop.db"\n')
  const first = await f.run()
  assert.match(first.status, /^CONFIGURATION VALIDÉE/)
  assert.ok(f.writes.length > 0)
  assert.equal(f.probes(), 3)
  for (const target of cloudModule.TARGETS) {
    assert.equal(first.environments[target].status, 'VALEURS ET CONNEXIONS VÉRIFIÉES')
    for (const file of manager.FILES[target]) {
      const env = core.readEnv(path.join(f.dir, file))
      assert.equal(env.DATABASE_URL, f.values[target].DATABASE_URL)
      assert.equal(env.DIRECT_URL, f.values[target].DIRECT_URL)
      assert.equal(env.BLOB_READ_WRITE_TOKEN, f.values[target].BLOB_READ_WRITE_TOKEN)
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.dir, file)).mode & 0o777, 0o600)
    }
  }
  assert.equal(fs.readFileSync(path.join(f.dir, '.env'), 'utf8'), 'DATABASE_URL="file:./desktop.db"\n')
  const backupCount = fs.readdirSync(path.join(f.dir, 'GarageFlow-configuration')).filter(n => n.startsWith('manager-backup-')).length
  const before = f.writes.length, server = fs.readFileSync(path.join(f.dir, '.env.server.local'), 'utf8')
  const second = await f.run()
  assert.match(second.status, /^CONFIGURATION VALIDÉE/)
  assert.equal(f.writes.length, before)
  assert.deepEqual(second.files, [])
  assert.equal(fs.readdirSync(path.join(f.dir, 'GarageFlow-configuration')).filter(n => n.startsWith('manager-backup-')).length, backupCount)
  assert.equal(fs.readFileSync(path.join(f.dir, '.env.server.local'), 'utf8'), server)
  const pub = JSON.stringify(second)
  for (const values of Object.values(f.values)) for (const [key, value] of Object.entries(values)) if (core.isSecret(key)) assert.ok(!pub.includes(value))
})

test('online simulation reads all targets but performs no probes, inputs, writes, backups or generated files', async t => {
  const f = fixture(t), before = tree(f.dir)
  const report = await f.run({ dryRun: true })
  assert.match(report.status, /SIMULATION/)
  assert.equal(f.connections(), 1)
  assert.equal(f.probes(), 0)
  assert.equal(f.writes.length, 0)
  assert.deepEqual(f.prompts, [])
  assert.deepEqual(tree(f.dir), before)
  assert.ok(!fs.existsSync(path.join(f.dir, 'GarageFlow-configuration')))
})

test('offline simulation never attempts account access and cannot claim Vercel or provider validation', async t => {
  const f = fixture(t), before = tree(f.dir)
  f.driver.connect = async () => { throw new Error('must never connect') }
  f.driver.read = async () => { throw new Error('must never read cloud') }
  const report = await f.run({ dryRun: true, offline: true })
  assert.match(report.status, /NON VÉRIFIÉS/)
  assert.deepEqual(tree(f.dir), before)
  assert.equal(f.probes(), 0)
  assert.equal(f.writes.length, 0)
})

test('a failed response AFTER server mutation is journaled and rolled back, including that attempted write', async t => {
  const f = fixture(t)
  f.control.failAt = 4; f.control.failAfterApply = true
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.deepEqual(report.restoration, [])
  assert.ok(!JSON.stringify(report).includes('private-provider-secret-error'))
  for (const target of cloudModule.TARGETS) assert.deepEqual(f.snapshots[target].records, [])
  assert.ok(!fs.existsSync(path.join(f.dir, '.env.production.local')))
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), 'utf8'))
  assert.equal(state.phase, 'preparing')
  assert.deepEqual(state.attempts, [])
})

test('a provider failure aborts globally BEFORE any env mutation; it is never printed as OK', async t => {
  const f = fixture(t)
  f.driver.probeBlob = async () => { throw new Error('private-blob-provider-output') }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(f.writes.length, 0)
  assert.equal(report.environments.development.checks.blob, undefined)
  assert.ok(report.errors.some(e => e.includes('Blob non vérifié')))
  assert.ok(!JSON.stringify(report).includes('private-blob-provider-output'))
})

test('missing information is checkpointed and the next run resumes with previously supplied values', async t => {
  const f = fixture(t)
  const file = path.join(f.dir, '.env.storage.preview.local')
  const seed = core.readEnv(file); delete seed.BLOB_READ_WRITE_TOKEN
  core.writePrivate(file, core.serializeEnv(seed, Object.keys(seed), 'fixture'))
  f.api.secretField = async () => {} // user presses Enter, suspend
  const interrupted = await f.run()
  assert.match(interrupted.status, /INTERROMPU/)
  assert.equal(f.writes.length, 0)
  const draft = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), 'utf8'))
  assert.ok(draft.drafts.development.NEXTAUTH_SECRET)
  let requested = 0
  f.api.secretField = async (env, key) => { requested++; assert.equal(key, 'BLOB_READ_WRITE_TOKEN'); env[key] = f.values.preview[key] }
  const complete = await f.run()
  assert.match(complete.status, /^CONFIGURATION VALIDÉE/)
  assert.equal(requested, 1)
  const actual = core.readEnv(path.join(f.dir, '.env.development.local'))
  assert.equal(actual.NEXTAUTH_SECRET, draft.drafts.development.NEXTAUTH_SECRET)
})

test('masked existing keys on a USED database are not regenerated, and missing originals block mutations', async t => {
  const f = fixture(t)
  addRecord(f, 'development', 'NEXTAUTH_SECRET', undefined, { type: 'sensitive' })
  f.driver.probeDatabase = async () => ({ pooled: true, direct: true, empty: false })
  f.api.secretField = async () => {}
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(f.writes.length, 0)
  assert.ok(!f.snapshots.development.values.NEXTAUTH_SECRET)
})

test('concurrent remote changes during preparation refuse the entire plan', async t => {
  const f = fixture(t), read = f.driver.read
  let n = 0
  f.driver.read = async (...args) => {
    n++
    if (n === 4) addRecord(f, 'development', 'CUSTOM_CONCURRENT', 'fixture-custom-value')
    return read(...args)
  }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(f.writes.length, 0)
  assert.match(report.errors.join(' '), /changé/)
})

test('masked readback gives partial verification, not a fictitious configuration OK', async t => {
  const f = fixture(t)
  const write = f.driver.write
  f.driver.write = async (...args) => { await write(...args); f.control.hide = true }
  const report = await f.run()
  assert.match(report.status, /PARTIELLE/)
  assert.ok(Object.values(report.environments).some(e => /NON VÉRIFIABLE/.test(e.status)))
  const count = f.writes.length
  const repeat = await f.run()
  assert.equal(f.writes.length, count)
  assert.match(repeat.status, /PARTIELLE/)
})

test('protected/integration and shared-target values cannot be silently changed; unknowns are preserved', () => {
  const snapshot = { records: [
    { key: 'BLOB_READ_WRITE_TOKEN', id: 'env_b', target: ['production'], contentHint: { storeId: 'store_fixture' } },
    { key: 'NEXTAUTH_SECRET', id: 'env_s', target: ['preview', 'production'] },
    { key: 'CUSTOM_UNKNOWN', id: 'env_u', target: ['production'] },
  ], values: { BLOB_READ_WRITE_TOKEN: 'old-fixture-value', NEXTAUTH_SECRET: 'old-fixture-internal' } }
  const p = manager.planTarget(snapshot, { BLOB_READ_WRITE_TOKEN: 'new-fixture-value', NEXTAUTH_SECRET: 'new-fixture-internal' }, policy, {}, 'production')
  assert.deepEqual(p.operations, [])
  assert.equal(p.blocked.length, 2)
  assert.ok(p.preserved.some(e => e.key === 'CUSTOM_UNKNOWN'))
})

test('protected masked values never acquire a fictional plaintext receipt', async t => {
  const f = fixture(t)
  addRecord(f, 'production', 'BLOB_READ_WRITE_TOKEN', undefined, { contentHint: { storeId: 'store_UnitTest' } })
  const report = await f.run()
  assert.match(report.status, /PARTIELLE/)
  const receipts = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/manager-receipts.json'), 'utf8'))
  assert.equal(receipts.environments.production.BLOB_READ_WRITE_TOKEN, undefined)
  assert.ok(!f.writes.some(w => w.target === 'production' && w.key === 'BLOB_READ_WRITE_TOKEN'))
})

test('Git tracking even an ignored .env blocks configuration, without force-adding or weakening rules', async t => {
  const f = fixture(t)
  execFileSync('git', ['add', '-f', '.env.storage.production.local'], { cwd: f.dir, stdio: 'ignore' })
  const report = await f.run()
  assert.equal(report.security.ok, false)
  assert.equal(f.connections(), 0)
  assert.equal(f.writes.length, 0)
})

test('symlinked vault parent is rejected before secret checkpoints', async t => {
  if (process.platform === 'win32') return
  const f = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-manager-outside-'))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  fs.symlinkSync(outside, path.join(f.dir, 'GarageFlow-configuration'), 'dir')
  const report = await f.run()
  assert.equal(report.security.ok, false)
  assert.deepEqual(fs.readdirSync(outside), [])
})

test('record filtering preserves branch/custom overrides and refuses duplicate general keys', () => {
  const records = [
    { id: 'env_1', key: 'DATABASE_URL', target: ['preview'] },
    { id: 'env_2', key: 'DATABASE_URL', target: ['preview'], gitBranch: 'feature' },
    { id: 'env_3', key: 'DATABASE_URL', target: ['preview'], customEnvironmentIds: ['env_custom'] },
    { id: 'env_4', key: 'DATABASE_URL', target: ['production'] },
  ]
  assert.deepEqual(cloudModule.recordsFor(records, 'preview'), [records[0]])
  assert.throws(() => cloudModule.recordsFor([...records, { ...records[0], id: 'env_5' }], 'preview'), /doublons/)
})

test('CLI simulation rejects incompatible options without starting the legacy full plan', () => {
  for (const args of [['--dry-run', '--conserver-secrets'], ['--offline'], ['--dry-run', '--profile', 'desktop'], ['--simulate', '--check'], ['--probe-blob-write', '--conserver-secrets'], ['--rotate-session-secrets', '--audit']]) {
    const r = spawnSync(process.execPath, ['config', ...args], { cwd: root, encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.ok(!r.stdout.includes('CONFIG COMPLET'))
  }
})

test('local concurrent edits are preserved rather than overwritten by rollback', async t => {
  const f = fixture(t), write = f.driver.write
  let edited = false
  f.driver.write = async (...args) => {
    await write(...args)
    if (!edited) { edited = true; fs.writeFileSync(path.join(f.dir, '.env.local'), 'USER_CONCURRENT_VALUE="preserve-me"\n') }
  }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(fs.readFileSync(path.join(f.dir, '.env.local'), 'utf8'), 'USER_CONCURRENT_VALUE="preserve-me"\n')
  for (const target of cloudModule.TARGETS) assert.deepEqual(f.snapshots[target].records, [])
})

test('rollback restores a readable removed variable and original type', async t => {
  const f = fixture(t)
  const key = policy.entries.find(e => e.action === 'unused')?.name
  assert.ok(key)
  addRecord(f, 'development', key, 'fixture-old-unused-value', { type: 'plain' })
  const original = structuredClone(f.snapshots.development)
  let failed = false, write = f.driver.write
  f.driver.write = async (...args) => {
    await write(...args)
    if (!failed && args[2].kind === 'remove') { failed = true; throw new Error('lost deletion response') }
  }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.deepEqual(report.restoration, [])
  const restored = f.snapshots.development.records.find(r => r.key === key)
  assert.equal(restored.type, 'plain')
  assert.equal(f.snapshots.development.values[key], original.values[key])
  assert.equal(f.snapshots.development.records.length, 1)
})

test('prefixed provider aliases are grouped by a bound resource and never assembled across two databases', () => {
  const records = [
    { key: 'CUSTOM_POSTGRES_URL', contentHint: { storeId: 'store_one', type: 'integration-store-secret' } },
    { key: 'CUSTOM_POSTGRES_URL_NON_POOLING', contentHint: { storeId: 'store_one', type: 'integration-store-secret' } },
  ]
  const values = { CUSTOM_POSTGRES_URL: 'fixture-pooled-url', CUSTOM_POSTGRES_URL_NON_POOLING: 'fixture-direct-url' }
  assert.equal(cloudModule.resourceAliases(records, values).DATABASE_URL, values.CUSTOM_POSTGRES_URL)
  assert.equal(cloudModule.resourceAliases(records, values).DIRECT_URL, values.CUSTOM_POSTGRES_URL_NON_POOLING)
  records[1].contentHint.storeId = 'store_two'
  assert.equal(cloudModule.resourceAliases(records, values).DATABASE_URL, undefined)
  assert.equal(cloudModule.resourceAliases(records, values).DIRECT_URL, undefined)
})

test('API adapter checks actual project ownership and keeps team + target scoping explicit', async t => {
  const f = fixture(t), calls = []
  fs.mkdirSync(path.join(f.dir, '.vercel'))
  fs.writeFileSync(path.join(f.dir, '.vercel/project.json'), JSON.stringify(project))
  const readValue = 'fixture-readable-preview-database'
  const record = { id: 'env_preview', key: 'DATABASE_URL', type: 'encrypted', target: ['preview'], value: 'ciphertext-not-a-credential', decrypted: false }
  const api = { ...f.api, tool: async (_name, args, options) => {
    calls.push(args)
    if (args[0] === 'whoami') return 'fixture-user'
    const url = new URL('https://api.vercel.com' + args[1])
    assert.equal(url.searchParams.get('teamId'), project.orgId)
    assert.equal(options.captureVercelApiFailure, true)
    if (url.pathname === `/v9/projects/${project.projectId}`) return JSON.stringify({ id: project.projectId, accountId: project.orgId })
    if (url.pathname.includes('/v10/projects/')) {
      assert.equal(url.searchParams.get('target'), 'preview')
      assert.equal(url.searchParams.get('decrypt'), 'true')
      return JSON.stringify({ envs: [record, { ...record, id: 'env_production', target: ['production'] }, { ...record, id: 'env_branch', gitBranch: 'feature' }] })
    }
    if (url.pathname.includes('/v3/env/pull/')) return JSON.stringify({ env: { DATABASE_URL: '[SENSITIVE]', UNRELATED: 'must-not-import' } })
    assert.ok(url.pathname.endsWith('/env/env_preview'))
    return JSON.stringify({ ...record, decrypted: true, value: readValue })
  } }
  const adapter = cloudModule.cloud(api)
  assert.deepEqual(await adapter.connect({ dryRun: true }), project)
  const snapshot = await adapter.read(project, 'preview')
  assert.deepEqual(snapshot.values, { DATABASE_URL: readValue })
  assert.equal(snapshot.branchOverrides, 1)
  assert.equal(snapshot.records.length, 1)
  assert.equal(snapshot.records[0].value, undefined)
  assert.ok(calls.every(args => !args.includes('--method')))
})

test('API writes use official v10 endpoints and private temporary JSON, never credential argv', async t => {
  const f = fixture(t), secret = 'fixture-sensitive-write-input', calls = []
  const api = { ...f.api, tool: async (_name, args) => {
    assert.ok(!JSON.stringify(args).includes(secret))
    const url = new URL('https://api.vercel.com' + args[1]); assert.equal(url.searchParams.get('teamId'), project.orgId)
    const method = args[args.indexOf('--method') + 1]
    const file = args.includes('--input') ? args[args.indexOf('--input') + 1] : null
    if (file) {
      const body = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.equal(body.value, secret)
      assert.deepEqual(body.target, ['preview'])
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    }
    calls.push({ path: url.pathname, method, file })
    return '{}'
  } }
  const adapter = cloudModule.cloud(api), record = { key: 'NEXTAUTH_SECRET', id: 'env_owned', target: ['preview'], type: 'encrypted' }
  await adapter.write(project, 'preview', { kind: 'create', key: 'NEXTAUTH_SECRET', value: secret }, { authorized: true })
  await adapter.write(project, 'preview', { kind: 'update', key: 'NEXTAUTH_SECRET', value: secret, record }, { authorized: true })
  await adapter.write(project, 'preview', { kind: 'remove', key: 'NEXTAUTH_SECRET', record }, { authorized: true })
  assert.deepEqual(calls.map(c => c.method), ['POST', 'PATCH', 'DELETE'])
  assert.ok(calls.every(c => c.path.startsWith('/v10/projects/prj_unit/env')))
  assert.ok(calls.filter(c => c.file).every(c => !fs.existsSync(c.file)))
  await assert.rejects(() => adapter.write(project, 'preview', { kind: 'update', key: record.key, value: secret, record: { ...record, target: ['preview', 'production'] } }, { authorized: true }), /multienvironnement/)
  await assert.rejects(() => adapter.write(project, 'preview', { kind: 'update', key: record.key, value: secret, record: { ...record, contentHint: { storeId: 'store_owned' } } }, { authorized: true }), /refusée/)
})

test('Blob refuses an unbound token BEFORE SDK call; permitted list is bounded and never uploads', async t => {
  const f = fixture(t); let calls = 0
  const adapter = cloudModule.cloud({ ...f.api, blobClient: { list: async options => { calls++; assert.equal(options.limit, 1); assert.ok(options.abortSignal); return { blobs: [] } } } })
  await assert.rejects(() => adapter.probeBlob(f.values.production, ['store_other']), /association/)
  assert.equal(calls, 0)
  const result = await adapter.probeBlob(f.values.production, ['store_UnitTest'])
  assert.equal(calls, 1)
  assert.equal(result.list, true)
  assert.equal(result.write, 'not_tested')
})

test('SQL probes use the actual Prisma client contract for BOTH URLs and disconnect on failure', async t => {
  const f = fixture(t), urls = [], sql = [], disconnected = []
  class Client {
    constructor(options) { this.url = options.datasourceUrl; urls.push(this.url); assert.deepEqual(options.log, []) }
    async $queryRawUnsafe(query) { sql.push(query); return [{ config_probe: 1 }] }
    async $disconnect() { disconnected.push(this.url) }
  }
  const adapter = cloudModule.cloud({ ...f.api, loadServerClient: () => ({ PrismaClient: Client }), services: { inspectDatabase: async (_root, url) => { assert.equal(url, f.values.production.DIRECT_URL); return { empty: false } } } })
  assert.deepEqual(await adapter.probeDatabase(f.values.production), { pooled: true, direct: true, empty: false })
  assert.deepEqual(urls, [f.values.production.DATABASE_URL, f.values.production.DIRECT_URL])
  assert.deepEqual(sql, ['SELECT 1 AS config_probe', 'SELECT 1 AS config_probe'])
  assert.deepEqual(disconnected, urls)
})

test('Blob write probe has separate consent, uses unique harmless content, and verifies deletion', async t => {
  const f = fixture(t), objects = new Map(), calls = []
  const blobClient = {
    list: async options => ({ blobs: [...objects.values()].filter(o => !options.prefix || o.pathname.startsWith(options.prefix)), hasMore: false }),
    put: async (pathname, value, options) => {
      calls.push('put'); assert.equal(options.allowOverwrite, false); assert.equal(options.addRandomSuffix, false)
      assert.equal(value, 'GarageFlows configuration probe')
      const object = { pathname, size: Buffer.byteLength(value), url: `https://unittest.public.blob.vercel-storage.com/${pathname}` }
      objects.set(object.url, object); return object
    },
    head: async url => { calls.push('head'); return objects.get(url) },
    del: async url => { calls.push('del'); objects.delete(url) },
  }
  const adapter = cloudModule.cloud({ ...f.api, blobClient })
  await assert.rejects(() => adapter.probeBlobWrite(f.values.production, ['store_UnitTest'], { access: 'public' }), /non autorisée/)
  assert.deepEqual(calls, [])
  assert.deepEqual(await adapter.probeBlobWrite(f.values.production, ['store_UnitTest'], { authorized: true, access: 'public' }), { write: true, read: true, delete: true })
  assert.deepEqual(calls, ['put', 'head', 'del'])
  assert.equal(objects.size, 0)
})

test('invalid Blob token can be corrected in-place without restarting preparation or leaking provider text', async t => {
  const f = fixture(t), output = [], yes = f.api.yes
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')))
  f.api.yes = async label => label.includes('corriger les accès Blob') ? true : yes(label)
  let inputs = 0
  f.api.secretField = async (env, key) => { inputs++; assert.equal(key, 'BLOB_READ_WRITE_TOKEN'); env[key] = 'vercel_blob_rw_UnitTest_fixture-replacement-not-issued' }
  f.driver.probeBlob = async env => {
    if (!env.BLOB_READ_WRITE_TOKEN.includes('replacement')) throw new Error('private-raw-provider-error-containing-token')
    return { associated: true, list: true, write: 'not_tested' }
  }
  const report = await f.run()
  assert.match(report.status, /^CONFIGURATION VALIDÉE/)
  assert.equal(inputs, 3)
  assert.equal(f.prompts.filter(p => p.includes('Saisir AUTORISER')).length, 1)
  assert.ok(!output.join('\n').includes('private-raw-provider-error-containing-token'))
  assert.ok(!output.join('\n').includes('vercel_blob_rw_UnitTest_fixture-replacement-not-issued'))
})

test('an interrupted process journal is reconciled before any new configuration mutation', async t => {
  const f = fixture(t)
  const operation = { kind: 'create', key: 'GF_PORTAL_SECRET', value: 'fixture-interrupted-internal-key-long-enough', type: 'encrypted', restorable: true, ownership: 'GarageFlows config fixture-transaction-owner' }
  await f.driver.write(project, 'preview', operation, { authorized: true })
  core.writePrivate(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), JSON.stringify({ schema: 1, project, drafts: {}, phase: 'applying', attempts: [{ target: 'preview', operation }], originalFiles: {}, localAttempts: [] }))
  const report = await f.run()
  assert.match(report.status, /^CONFIGURATION VALIDÉE/)
  assert.deepEqual(f.writes[1], { kind: 'remove', target: 'preview', key: 'GF_PORTAL_SECRET' })
  assert.notEqual(f.snapshots.preview.values.GF_PORTAL_SECRET, operation.value)
})

test('rollback will not delete or overwrite an unrelated concurrent value after a failed write', async t => {
  const f = fixture(t), write = f.driver.write
  let failed = false
  f.driver.write = async (...args) => {
    await write(...args)
    if (!failed) {
      failed = true
      f.snapshots[args[1]].values[args[2].key] = 'fixture-concurrent-operator-change'
      throw new Error('lost response during concurrent change')
    }
  }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.ok(report.restoration.length > 0)
  assert.ok(Object.values(f.snapshots.development.values).includes('fixture-concurrent-operator-change'))
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), 'utf8'))
  assert.equal(state.phase, 'rollback-incomplete')
})

test('a masked NEXT_PUBLIC secret is still detected before probes and never counted as safe', async t => {
  const f = fixture(t)
  addRecord(f, 'development', 'NEXT_PUBLIC_PROVIDER_TOKEN', undefined, { type: 'sensitive' })
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(f.probes(), 0)
  assert.equal(f.writes.length, 0)
  assert.match(report.errors.join(' '), /NEXT_PUBLIC_PROVIDER_TOKEN/)
  assert.match(manager.render(report), /Variables requises manquantes : NON FINALISÉ/)
})

test('Blob write probe never claims successful cleanup when deletion/readback is unconfirmed', async t => {
  const f = fixture(t), objects = new Map()
  const adapter = cloudModule.cloud({ ...f.api, blobClient: {
    list: async () => ({ blobs: [...objects.values()], hasMore: false }),
    put: async pathname => { const object = { pathname, size: Buffer.byteLength('GarageFlows configuration probe'), url: `https://unittest.private.blob.vercel-storage.com/${pathname}` }; objects.set(object.url, object); return object },
    head: async url => objects.get(url), del: async () => {},
  } })
  await assert.rejects(() => adapter.probeBlobWrite(f.values.production, ['store_UnitTest'], { authorized: true, access: 'private' }), error => {
    assert.equal(error.probe.cleanupVerified, false)
    assert.match(error.probe.pathname, /^garageflows-config-probe\/[a-f0-9-]+\.txt$/)
    assert.ok(!error.message.includes(f.values.production.BLOB_READ_WRITE_TOKEN))
    return true
  })
})

test('rollback never removes another concurrent creator even if they supplied the same value', async t => {
  const f = fixture(t)
  addRecord(f, 'development', 'NEXTAUTH_SECRET', 'fixture-same-value', { comment: 'another-operator' })
  const failures = await manager.rollback(f.driver, project, [{ target: 'development', operation: { kind: 'create', key: 'NEXTAUTH_SECRET', value: 'fixture-same-value', ownership: 'GarageFlows config unique-owner', restorable: true } }])
  assert.equal(failures.length, 1)
  assert.equal(f.writes.length, 0)
  assert.equal(f.snapshots.development.values.NEXTAUTH_SECRET, 'fixture-same-value')
})

test('HTTP loopback is allowed only for Development URLs, never Redis or Production', () => {
  const base = core.fillMissing({ ...credentials.neonVariables('fixture-password'), NEXTAUTH_URL: 'http://localhost:4028', GF_APP_URL: 'http://localhost:4028', UPSTASH_REDIS_REST_URL: 'https://unit.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'fixture-redis-token-not-issued' }, core.namesForProfile(policy.names, 'pwa'), 'pwa')
  assert.deepEqual(core.validate(base, 'pwa', { vercel: true, allowLocalHttp: true }), [])
  assert.ok(core.validate(base, 'pwa', { vercel: true }).some(e => e.startsWith('NEXTAUTH_URL')))
  assert.ok(core.validate({ ...base, NEXTAUTH_URL: 'http://example.invalid' }, 'pwa', { vercel: true, allowLocalHttp: true }).some(e => e.startsWith('NEXTAUTH_URL')))
  assert.ok(core.validate({ ...base, UPSTASH_REDIS_REST_URL: 'http://localhost:6379' }, 'pwa', { vercel: true, allowLocalHttp: true }).some(e => e.startsWith('UPSTASH_REDIS_REST_URL')))
})

test('verbose third-party debug modes are refused before libraries can print credentials', async t => {
  const f = fixture(t), previous = process.env.DEBUG
  process.env.DEBUG = 'blob,prisma:*'
  t.after(() => { if (previous === undefined) delete process.env.DEBUG; else process.env.DEBUG = previous })
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(f.connections(), 0)
  assert.equal(f.probes(), 0)
  assert.match(report.errors.join(' '), /DEBUG/)
})

test('fresh internal secrets are generated in the expected formats without secret input and stay independent per target', async t => {
  const f = fixture(t)
  f.driver.recover = async () => { throw new Error('unnecessary provider recovery') }
  const first = await f.run()
  assert.match(first.status, /^CONFIGURATION VALIDÉE/)
  const seen = new Set()
  for (const target of cloudModule.TARGETS) {
    const env = core.readEnv(path.join(f.dir, `.env.${target}.local`))
    for (const [name, format] of Object.entries(core.GENERATED)) {
      if (!core.namesForProfile(policy.names, 'pwa').includes(name)) continue
      assert.ok(env[name], `${target} / ${name} must be generated automatically`)
      const bytes = Buffer.from(env[name], format)
      assert.equal(bytes.length, 32, `${name} must have 256 bits`)
      assert.equal(bytes.toString(format), env[name], `${name} must use canonical ${format}`)
      assert.ok(!seen.has(env[name]), 'every key/environment must be independent')
      seen.add(env[name])
    }
  }
  assert.ok(!f.prompts.some(label => /tenter la récupération/.test(label)), 'complete Vercel/local values must not trigger provider recovery')
  const files = () => Object.fromEntries(Object.entries(tree(f.dir)).filter(([name]) => !name.startsWith('GarageFlow-configuration/')))
  const before = files(), count = f.writes.length
  await f.run()
  assert.equal(f.writes.length, count)
  assert.deepEqual(files(), before)
})

test('a missing first-use NextAuth secret is generated even on a used database; existing protection keys are preserved', async t => {
  const f = fixture(t)
  f.driver.probeDatabase = async () => ({ pooled: true, direct: true, empty: false })
  for (const target of cloudModule.TARGETS) {
    for (const [name, format] of Object.entries(core.GENERATED)) {
      if (!['NEXTAUTH_SECRET', 'GARAGEFLOW_API_KEY'].includes(name) && core.namesForProfile(policy.names, 'pwa').includes(name)) {
        const value = require('node:crypto').randomBytes(32).toString(format)
        f.values[target][name] = value
        addRecord(f, target, name, value)
      }
    }
  }
  const report = await f.run()
  assert.match(report.status, /^CONFIGURATION VALIDÉE/)
  for (const target of cloudModule.TARGETS) {
    const env = core.readEnv(path.join(f.dir, `.env.${target}.local`))
    assert.equal(Buffer.from(env.NEXTAUTH_SECRET, 'base64').length, 32)
    assert.match(env.GARAGEFLOW_API_KEY, /^[a-f0-9]{64}$/)
    assert.equal(env.GF_BACKUP_KEY, f.values[target].GF_BACKUP_KEY)
    assert.deepEqual(report.environments[target].generated, ['NEXTAUTH_SECRET', 'GARAGEFLOW_API_KEY'])
  }
})

test('early first-use generation survives a missing provider input without inventing credentials or rotating on resume', async t => {
  const f = fixture(t)
  const file = path.join(f.dir, '.env.storage.development.local')
  const seed = core.readEnv(file); delete seed.BLOB_READ_WRITE_TOKEN
  core.writePrivate(file, core.serializeEnv(seed, Object.keys(seed), 'fixture'))
  f.api.secretField = async () => {}
  const first = await f.run()
  assert.match(first.status, /INTERROMPU/)
  assert.deepEqual(first.environments.development.generated, ['NEXTAUTH_SECRET', 'GARAGEFLOW_API_KEY'])
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), 'utf8'))
  const original = state.drafts.development.NEXTAUTH_SECRET
  assert.equal(Buffer.from(original, 'base64').length, 32)
  assert.ok(!state.drafts.development.BLOB_READ_WRITE_TOKEN)
  assert.equal(f.writes.length, 0)
  f.api.secretField = async (env, name) => { assert.equal(name, 'BLOB_READ_WRITE_TOKEN'); env[name] = f.values.development[name] }
  assert.match((await f.run()).status, /^CONFIGURATION VALIDÉE/)
  assert.equal(core.readEnv(path.join(f.dir, '.env.development.local')).NEXTAUTH_SECRET, original)
})

test('provider credentials and existing internal keys are taken from each Vercel target without manual input', async t => {
  const f = fixture(t)
  const originals = {}
  for (const target of cloudModule.TARGETS) {
    fs.rmSync(path.join(f.dir, `.env.storage.${target}.local`))
    for (const name of manager.BASE_REQUIRED) addRecord(f, target, name, f.values[target][name])
    originals[target] = require('node:crypto').randomBytes(32).toString('base64')
    addRecord(f, target, 'NEXTAUTH_SECRET', originals[target])
  }
  f.driver.recover = async () => { throw new Error('Vercel already supplied provider values') }
  assert.match((await f.run()).status, /^CONFIGURATION VALIDÉE/)
  for (const target of cloudModule.TARGETS) {
    const env = core.readEnv(path.join(f.dir, `.env.${target}.local`))
    assert.equal(env.NEXTAUTH_SECRET, originals[target])
    assert.equal(env.DATABASE_URL, f.values[target].DATABASE_URL)
    assert.equal(env.UPSTASH_REDIS_REST_TOKEN, f.values[target].UPSTASH_REDIS_REST_TOKEN)
    assert.equal(env.BLOB_READ_WRITE_TOKEN, f.values[target].BLOB_READ_WRITE_TOKEN)
    assert.ok(!f.writes.some(w => w.target === target && w.key === 'NEXTAUTH_SECRET'))
  }
})

test('unrecoverable provider values are requested, never generated as internal random secrets', async t => {
  const f = fixture(t), requested = []
  const file = path.join(f.dir, '.env.storage.development.local')
  const seed = core.readEnv(file)
  for (const name of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete seed[name]
  core.writePrivate(file, core.serializeEnv(seed, Object.keys(seed), 'fixture'))
  f.api.secretField = async (env, name) => { requested.push(name); env[name] = f.values.development[name] }
  const report = await f.run()
  assert.match(report.status, /^CONFIGURATION VALIDÉE/)
  assert.deepEqual(requested, ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])
  assert.ok(!report.environments.development.generated.some(name => /DATABASE|REDIS|BLOB/.test(name)))
  assert.equal(core.readEnv(path.join(f.dir, '.env.development.local')).UPSTASH_REDIS_REST_TOKEN, f.values.development.UPSTASH_REDIS_REST_TOKEN)
})

test('a used database with a missing backup encryption key requires the original, even when the field is optional', async t => {
  const f = fixture(t), requested = []
  f.driver.probeDatabase = async () => ({ pooled: true, direct: true, empty: false })
  for (const [name, format] of Object.entries(core.GENERATED)) {
    if (!['NEXTAUTH_SECRET', 'GARAGEFLOW_API_KEY', 'GF_BACKUP_KEY'].includes(name) && core.namesForProfile(policy.names, 'pwa').includes(name)) {
      addRecord(f, 'development', name, require('node:crypto').randomBytes(32).toString(format))
    }
  }
  f.api.secretField = async (_env, name) => { requested.push(name) }
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.deepEqual(requested, ['GF_BACKUP_KEY'])
  assert.ok(report.errors.some(message => message.includes('GF_BACKUP_KEY')))
  assert.ok(!report.environments.development.generated.includes('GF_BACKUP_KEY'))
  assert.equal(f.writes.length, 0)
})

test('dashboard input accepts bare, quoted and dotenv provider values without rewriting raw passwords', () => {
  const token = 'vercel_blob_rw_UnitTest_fixture-renewed-not-issued'
  for (const input of [token, `  ${token}  `, `"${token}"`, `'${token}'`, `BLOB_READ_WRITE_TOKEN="${token}"`, `export BLOB_READ_WRITE_TOKEN = '${token}'`]) {
    assert.equal(core.normalizeInput('BLOB_READ_WRITE_TOKEN', input), token)
    assert.equal(require('../scripts/config-rebuild.cjs').normalizeStorage({ BLOB_READ_WRITE_TOKEN: input }).BLOB_READ_WRITE_TOKEN, token)
  }
  assert.equal(core.normalizeInput('DATABASE_URL', 'DATABASE_URL="postgresql://unit:p%40ss@ep-unit-pooler.neon.tech/db?sslmode=require"'), 'postgresql://unit:p%40ss@ep-unit-pooler.neon.tech/db?sslmode=require')
  assert.equal(core.normalizeInput('UPSTASH_REDIS_REST_TOKEN', 'ABCD='), 'ABCD=', 'an opaque base64 token is not a dotenv assignment')
  const password = '  "raw=p#ss%40"  '
  assert.equal(core.normalizeInput('PGPASSWORD', password), password)
  for (const input of ['NEXTAUTH_URL="https://wrong-field.invalid"', `BLOB_READ_WRITE_TOKEN="${token}`, `BLOB_READ_WRITE_TOKEN=${token}\nOTHER=value`]) {
    assert.throws(() => core.normalizeInput('BLOB_READ_WRITE_TOKEN', input), error => error.configSafe && !error.message.includes(token))
  }
})

test('a previous draft containing the full dashboard assignment resumes with the normalized token', async t => {
  const f = fixture(t)
  core.writePrivate(path.join(f.dir, 'GarageFlow-configuration/manager-state.json'), JSON.stringify({ schema: 1, project, drafts: {
    development: { BLOB_READ_WRITE_TOKEN: `BLOB_READ_WRITE_TOKEN="${f.values.development.BLOB_READ_WRITE_TOKEN}"` },
  }, phase: 'preparing', attempts: [] }))
  f.driver.probeBlob = async env => {
    assert.match(env.BLOB_READ_WRITE_TOKEN, /^vercel_blob_rw_UnitTest_fixture-/)
    assert.ok(!env.BLOB_READ_WRITE_TOKEN.includes('BLOB_READ_WRITE_TOKEN='))
    return { associated: true, list: true, write: 'not_tested' }
  }
  assert.match((await f.run()).status, /^CONFIGURATION VALIDÉE/)
  assert.equal(core.readEnv(path.join(f.dir, '.env.development.local')).BLOB_READ_WRITE_TOKEN, f.values.development.BLOB_READ_WRITE_TOKEN)
})

test('Blob discovery reads detailed scopes when a legacy list has no type and incomplete project metadata', async t => {
  const f = fixture(t), calls = []
  const adapter = cloudModule.cloud({ ...f.api, tool: async (_name, args) => {
    const u = new URL('https://api.vercel.com' + args[1]); calls.push(u.pathname)
    assert.equal(u.searchParams.get('teamId'), project.orgId)
    if (u.pathname === '/v1/storage/stores') return JSON.stringify({ stores: [{ id: 'store_UnitTest', projectsMetadata: [] }] })
    assert.equal(u.pathname, '/v1/storage/stores/store_UnitTest')
    return JSON.stringify({ store: { id: 'store_UnitTest', projectsMetadata: [{ projectId: project.projectId, environments: ['development'] }] } })
  } })
  assert.deepEqual(await adapter.blobStores(project, 'development', { records: [] }), ['store_UnitTest'])
  assert.deepEqual(calls, ['/v1/storage/stores', '/v1/storage/stores/store_UnitTest'])
})

test('Blob discovery falls back to connections and never imports Production binding into Development', async t => {
  const f = fixture(t), calls = []
  const adapter = cloudModule.cloud({ ...f.api, tool: async (_name, args) => {
    const pathname = new URL('https://api.vercel.com' + args[1]).pathname; calls.push(pathname)
    if (pathname === '/v1/storage/stores') return JSON.stringify({ stores: [{ id: 'store_UnitTest', type: 'blob', projectsMetadata: [{ projectId: project.projectId }] }] })
    if (pathname.endsWith('/connections')) return JSON.stringify({ connections: [{ projectId: project.projectId, envVarEnvironments: ['production'] }] })
    return JSON.stringify({ store: { id: 'store_UnitTest', type: 'blob', projectsMetadata: [] } })
  } })
  assert.deepEqual(await adapter.blobStores(project, 'development', { records: [] }), [])
  assert.ok(calls.some(p => p.endsWith('/connections')))
  assert.deepEqual(await adapter.blobStores(project, 'production', { records: [] }), ['store_UnitTest'])
})

test('project-scoped Blob hints remain usable when team-wide inventory is denied, without trusting other scopes', async t => {
  const f = fixture(t)
  const adapter = cloudModule.cloud({ ...f.api, tool: async () => { throw new Error('private-provider-response') } })
  const record = { key: 'CUSTOM_BLOB_READ_WRITE_TOKEN', target: ['development'], contentHint: { type: 'blob-read-write-token', storeId: 'store_UnitTest' } }
  assert.deepEqual(await adapter.blobStores(project, 'development', { records: [record] }), ['store_UnitTest'])
  for (const other of [{ ...record, target: ['production'] }, { ...record, gitBranch: 'other' }, { ...record, customEnvironmentIds: ['custom'] }]) {
    await assert.rejects(() => adapter.blobStores(project, 'development', { records: [other] }), e => e.configBlobCode === 'stores_inventory' && !e.message.includes('private-provider-response'))
  }
})

test('a discovered binding accepts normalized Blob input but still requires a successful SDK list', async t => {
  const f = fixture(t); let calls = 0
  const token = f.values.development.BLOB_READ_WRITE_TOKEN
  const adapter = cloudModule.cloud({ ...f.api, blobClient: { list: async options => {
    calls++; assert.equal(options.token, token); return { blobs: [] }
  } } })
  assert.equal((await adapter.probeBlob({ BLOB_READ_WRITE_TOKEN: `BLOB_READ_WRITE_TOKEN="${token}"` }, ['store_UnitTest'])).list, true)
  assert.equal(calls, 1)
  await assert.rejects(() => adapter.probeBlob(f.values.development, []), e => e.configBlobCode === 'store_association')
  await assert.rejects(() => adapter.probeBlob(f.values.development, ['store_other']), e => e.configBlobCode === 'token_store_mismatch')
  assert.equal(calls, 1, 'no SDK request with an unbound token')
})

test('Blob errors expose only whitelisted diagnoses, never provider payloads, names or tokens', async t => {
  const f = fixture(t)
  for (const [name, code] of [
    ['BlobAccessError', 'access_denied'], ['BlobStoreNotFoundError', 'store_not_found'],
    ['BlobStoreSuspendedError', 'store_suspended'], ['BlobServiceNotAvailable', 'service_unavailable'],
    ['BlobServiceRateLimited', 'service_unavailable'], ['TypeError', 'request_failed'],
    ['private-name-with-token', 'request_failed'], ['constructor', 'request_failed'],
  ]) {
    const adapter = cloudModule.cloud({ ...f.api, blobClient: { list: async () => {
      const error = new Error('private-provider-payload-with-token'); error.name = name; throw error
    } } })
    await assert.rejects(() => adapter.probeBlob(f.values.development, ['store_UnitTest']), error => {
      assert.equal(error.configBlobCode, code)
      assert.ok(!error.message.includes('private-'))
      assert.ok(!error.message.includes(f.values.development.BLOB_READ_WRITE_TOKEN))
      return true
    })
  }
})

test('an unconfirmed Blob binding can be rechecked after correction without requesting the same token again', async t => {
  const f = fixture(t), output = [], yes = f.api.yes
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')))
  let inventory = 0
  f.driver.blobStores = async () => {
    if (++inventory === 1) { const error = new Error('private-payload'); error.configBlobCode = 'store_association'; throw error }
    return ['store_UnitTest']
  }
  f.api.yes = async label => label.includes('réessayer la vérification Blob') ? true : yes(label)
  const report = await f.run()
  assert.match(report.status, /^CONFIGURATION VALIDÉE/)
  assert.ok(output.join('\n').includes('Connect Project'))
  assert.ok(!output.join('\n').includes('private-payload'))
  assert.equal(report.environments.development.blobDiagnostic, undefined)
  assert.equal(inventory, 4)
})

test('unconfirmed Blob inventory is reported as such, not as an invalid token, and never triggers a replacement input', async t => {
  const f = fixture(t), yes = f.api.yes
  f.driver.blobStores = async () => { const e = new Error('private inventory payload'); e.configBlobCode = 'stores_inventory'; throw e }
  f.api.yes = async label => label.includes('réessayer la vérification Blob') ? false : yes(label)
  const report = await f.run()
  assert.match(report.status, /INTERROMPU/)
  assert.equal(report.environments.development.blobDiagnostic.code, 'stores_inventory')
  assert.match(manager.render(report), /Cela ne prouve pas que le token est invalide/)
  assert.ok(!JSON.stringify(report).includes('private inventory payload'))
  assert.equal(f.writes.length, 0)
})

test('real Blob SDK error classes are recognized even though Error.name is not the subclass name', async t => {
  const f = fixture(t), sdk = require('@vercel/blob')
  for (const [name, expected] of [['BlobAccessError', 'access_denied'], ['BlobStoreSuspendedError', 'store_suspended'], ['BlobServiceNotAvailable', 'service_unavailable']]) {
    const error = new sdk[name]()
    assert.equal(error.name, 'Error', 'official SDK 2.8.2 behavior')
    error.message = 'private-provider-message-must-not-appear'
    const adapter = cloudModule.cloud({ ...f.api, blobClient: { [name]: sdk[name], list: async () => { throw error } } })
    await assert.rejects(() => adapter.probeBlob(f.values.development, ['store_UnitTest']), failure => {
      assert.equal(failure.configBlobCode, expected)
      assert.ok(!failure.message.includes('private-provider-message'))
      return true
    })
  }
})

test('a unique prefixed Blob token from the current Vercel target is recovered, but ambiguous stores are never guessed', () => {
  const key = 'CUSTOM_BLOB_READ_WRITE_TOKEN', token = 'vercel_blob_rw_UnitTest_fixture-not-issued'
  assert.equal(cloudModule.resourceAliases([{ key }], { [key]: token }).BLOB_READ_WRITE_TOKEN, token)
  assert.equal(cloudModule.resourceAliases([{ key, contentHint: { storeId: 'store_UnitTest' } }], { [key]: token }).BLOB_READ_WRITE_TOKEN, token)
  const other = 'SECOND_BLOB_READ_WRITE_TOKEN'
  assert.equal(cloudModule.resourceAliases([{ key }, { key: other }], { [key]: token, [other]: 'vercel_blob_rw_Other_fixture-not-issued' }).BLOB_READ_WRITE_TOKEN, undefined)
  assert.equal(cloudModule.resourceAliases([{ key }], { [key]: token, BLOB_READ_WRITE_TOKEN: 'canonical-value' }).BLOB_READ_WRITE_TOKEN, 'canonical-value')
  assert.equal(core.normalizeInput('NEXTAUTH_URL', 'https://unit.invalid/#fragment'), 'https://unit.invalid/#fragment', 'do not hide a raw URL fragment from validation')
})

test('known exposed Blob inputs are refused before SDK access, including dashboard wrappers', async t => {
  const f = fixture(t), token = f.values.development.BLOB_READ_WRITE_TOKEN
  const registry = path.join(f.dir, 'scripts/compromised-secrets.json')
  const contents = JSON.parse(fs.readFileSync(registry, 'utf8'))
  contents.entries.push({ env: 'BLOB_READ_WRITE_TOKEN', sha256Prefix: credentials.hash(token) })
  fs.writeFileSync(registry, JSON.stringify(contents))
  let calls = 0
  const adapter = cloudModule.cloud({ ...f.api, blobClient: { list: async () => { calls++; return { blobs: [] } } } })
  await assert.rejects(() => adapter.probeBlob({ BLOB_READ_WRITE_TOKEN: `BLOB_READ_WRITE_TOKEN="${token}"` }, ['store_UnitTest']), e => e.configBlobCode === 'token_exposed' && !e.message.includes(token))
  assert.equal(calls, 0)
})

test('a Blob token mismatch can be retried with Enter after a dashboard correction, without losing the current token', async t => {
  const f = fixture(t), yes = f.api.yes
  let attempt = 0, inputs = 0
  f.driver.probeBlob = async () => {
    if (++attempt === 1) { const e = new Error('private'); e.configBlobCode = 'token_store_mismatch'; throw e }
    return { associated: true, list: true, write: 'not_tested' }
  }
  f.api.yes = async label => label.includes('corriger les accès Blob') ? true : yes(label)
  f.api.secretField = async (env, name, label) => {
    inputs++; assert.equal(name, 'BLOB_READ_WRITE_TOKEN')
    assert.equal(env[name], f.values.development.BLOB_READ_WRITE_TOKEN)
    assert.match(label, /conserver et revérifier/)
    // user presses Enter: normal secretField preserves this hidden default
  }
  assert.match((await f.run()).status, /^CONFIGURATION VALIDÉE/)
  assert.equal(inputs, 1)
})

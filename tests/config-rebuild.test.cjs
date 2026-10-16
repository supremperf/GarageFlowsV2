'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const core = require('../scripts/config-core.cjs')
const rebuild = require('../scripts/config-rebuild.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-rebuild-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.vercel'))
  fs.writeFileSync(path.join(root, '.vercel/project.json'), JSON.stringify({ orgId: 'team_test', projectId: 'prj_test' }))
  const values = {
    POSTGRES_URL: 'postgresql://owner:fake-password@ep-test-pooler.neon.tech/db?sslmode=require',
    POSTGRES_URL_NON_POOLING: 'postgresql://owner:fake-password@ep-test.neon.tech/db?sslmode=require',
    KV_REST_API_URL: 'https://redis.example.invalid', KV_REST_API_TOKEN: 'fake-provider-token',
    NEXTAUTH_URL: 'https://app.example.invalid', BLOB_READ_WRITE_TOKEN: 'fake-blob-token',
    NEXTAUTH_SECRET: 'old-application-secret',
  }
  let current = {
    values: { ...values }, hidden: new Set(), present: new Set(Object.keys(values)),
    stamps: Object.fromEntries(Object.keys(values).map(n => [n, `old-${n}`])),
    records: Object.keys(values).map(key => ({ key })),
  }
  const commands = []
  let prompts = 0
  const base = {
    root,
    setupVercel: async options => { assert.equal(options.authorized, true); return structuredClone(current) },
    pullVercel: async () => structuredClone(current),
    services: { inspectDatabase: async () => ({ empty: true }) },
    question: async () => { prompts++; return 'AUTORISER' },
    tool: async (program, args, options = {}) => {
      assert.equal(program, 'vercel')
      commands.push({ args, input: options.input })
      if (args[0] === 'env' && args[1] === 'rm') {
        assert.equal(options.input, undefined, 'no secret sent to deletion')
        const key = args[2]
        delete current.values[key]; delete current.stamps[key]
        current.present.delete(key); current.hidden.delete(key)
        current.records = current.records.filter(r => r.key !== key)
      } else if (args[0] === 'env' && args[1] === 'add') {
        const key = args[2]
        current.present.add(key)
        if (args.includes('--sensitive')) current.hidden.add(key)
        else current.values[key] = options.input
        current.stamps[key] = `new-${key}`
        current.records.push({ key })
      } else throw new Error('Unexpected tool call')
      return ''
    },
  }
  const names = ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'DEVICE_TOKEN_PEPPER', 'GARAGEFLOW_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']
  return { root, base, values, names, commands, get current() { return current }, set current(v) { current = v }, get prompts() { return prompts } }
}

test('Storage vendor aliases map to canonical names without guessing an unpooled host', () => {
  const r = rebuild.normalizeStorage({ DATABASE_URL: 'postgresql://u:[fake@pool.test](mailto:fake@pool.test)/db?sslmode=require&amp;channel_binding=require',
    DATABASE_URL_UNPOOLED: 'postgresql://u:fake@direct.test/db', KV_REST_API_URL: '[https://redis.test](https://redis.test)', KV_REST_API_TOKEN: 'fake-token' })
  assert.equal(r.DATABASE_URL, 'postgresql://u:fake@pool.test/db?sslmode=require&channel_binding=require')
  assert.equal(r.DIRECT_URL, 'postgresql://u:fake@direct.test/db')
  assert.equal(r.UPSTASH_REDIS_REST_URL, 'https://redis.test')
  assert.equal(r.UPSTASH_REDIS_REST_TOKEN, 'fake-token')
  assert.equal(rebuild.normalizeStorage({ DATABASE_URL: 'postgresql://u:p@pool.test/db' }).DIRECT_URL, undefined)
})

test('read-only Redis credentials are never mistaken for a write token', () => {
  assert.equal(rebuild.normalizeStorage({ KV_REST_API_READ_ONLY_TOKEN: 'fake-read-only' }).UPSTASH_REDIS_REST_TOKEN, undefined)
})

test('planning protects integration and platform variables and refuses un-restorable values', () => {
  const remote = { records: [{ key: 'CUSTOM_SECRET' }, { key: 'POSTGRES_URL', configurationId: 'integration_test' }, { key: 'VERCEL' }],
    values: { CUSTOM_SECRET: 'original' } }
  const plan = rebuild.planRebuild(remote, { NEXTAUTH_SECRET: 'new' }, ['NEXTAUTH_SECRET'], ['VERCEL'])
  assert.deepEqual(plan.remove, ['CUSTOM_SECRET'])
  assert.deepEqual(plan.values, { CUSTOM_SECRET: 'original', NEXTAUTH_SECRET: 'new' })
  assert.deepEqual(plan.protectedNames, ['POSTGRES_URL', 'VERCEL'])
  assert.throws(() => rebuild.planRebuild({ ...remote, values: {} }, {}, []), /CUSTOM_SECRET est illisible/)
  assert.throws(() => rebuild.planRebuild(remote, { POSTGRES_URL: 'different' }, ['POSTGRES_URL'], ['VERCEL']), /appartient à une intégration/)
})

test('duplicate/branch-specific records cannot produce an ambiguous wipe', () => {
  assert.throws(() => rebuild.planRebuild({ records: [{ key: 'A' }, { key: 'A' }], values: {} }, {}, []), /dupliquées/)
  assert.throws(() => rebuild.planRebuild({ values: {} }, {}, []), /inventaire complet/)
})

test('Storage recovery refreshes only resources already connected to the authorized project', async () => {
  const calls = []
  const base = { tool: async (_tool, args) => {
    calls.push(args)
    if (args[0] === 'api') return JSON.stringify({ stores: [
      { id: 'store_this', type: 'integration', projectsMetadata: [{ projectId: 'prj_test' }] },
      { id: 'store_other', type: 'integration', projectsMetadata: [{ projectId: 'prj_other' }] },
      { id: 'store_blob', type: 'blob', projectsMetadata: [{ projectId: 'prj_test' }] },
    ] })
    return ''
  }, pullVercel: async () => ({ recovered: true }) }
  const result = await rebuild.recoverStorage(base, { values: {} }, { orgId: 'team_test', projectId: 'prj_test' })
  assert.equal(result.recovered, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], ['integration-resource', 'connect', 'store_this', 'prj_test', '--environment', 'production', '--yes', '--scope', 'team_test'])
})

test('after authorization: backup, automatic generation, wipe and rewrite without credential prompts', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  assert.equal(await api.question('Saisir AUTORISER'), 'AUTORISER')
  const remote = await api.setupVercel()
  const env = await api.importRemote({}, remote, f.names)
  assert.notEqual(env.NEXTAUTH_SECRET, f.values.NEXTAUTH_SECRET)
  assert.equal(Buffer.from(env.NEXTAUTH_SECRET, 'base64').length, 32)
  assert.equal(Buffer.from(env.GARAGEFLOW_API_KEY, 'hex').length, 32)
  assert.equal(env.DIRECT_URL, f.values.POSTGRES_URL_NON_POOLING)
  assert.equal(f.commands.length, 0, 'no mutation before preflight and file backup')
  await api.syncVercel(env, f.names)
  const firstAdd = f.commands.findIndex(c => c.args[1] === 'add')
  const lastDelete = f.commands.findLastIndex(c => c.args[1] === 'rm')
  assert.ok(firstAdd > lastDelete, 'all deletions precede all additions')
  assert.ok(f.commands.every(c => c.args[3] === 'production'), 'preview/development untouched')
  assert.equal(f.prompts, 1, 'only AUTORISER was requested')
  assert.ok(!fs.existsSync(path.join(f.root, 'GarageFlow-configuration/rebuild-pending.json')))
  assert.ok(fs.existsSync(path.join(f.root, '.env.storage.local')))
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'GarageFlow-configuration/secrets-receipt.json'), 'utf8'))
  assert.equal(receipt.projet, 'team_test/prj_test')
  assert.equal(JSON.stringify(receipt).includes(env.NEXTAUTH_SECRET), false)
  const backups = fs.readdirSync(path.join(f.root, 'GarageFlow-configuration')).filter(n => n.startsWith('rebuild-') && !n.endsWith('.json'))
  assert.equal(backups.length, 1)
  const old = fs.readFileSync(path.join(f.root, 'GarageFlow-configuration', backups[0], 'vercel-original.env'), 'utf8')
  assert.match(old, /old-application-secret/)
})

test('provider aliases from Vercel take precedence over stale local canonical credentials', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel()
  const env = await api.importRemote({ DATABASE_URL: 'postgresql://stale:old@old.test/db' }, remote, f.names)
  assert.equal(env.DATABASE_URL, f.values.POSTGRES_URL)
})

test('missing Storage access fails before generation/deletion, without requesting manual values', async t => {
  const f = fixture(t)
  delete f.current.values.POSTGRES_URL_NON_POOLING
  const api = rebuild.automaticApi(f.base), remote = await api.setupVercel()
  await assert.rejects(() => api.importRemote({}, remote, f.names), /Accès Storage introuvables : DIRECT_URL/)
  assert.ok(!f.commands.some(c => c.args[0] === 'env'))
  assert.equal(f.prompts, 0)
})

test('used database cannot be silently given new encryption keys', async t => {
  const f = fixture(t)
  f.base.services.inspectDatabase = async () => ({ empty: false })
  const api = rebuild.automaticApi(f.base), remote = await api.setupVercel()
  await assert.rejects(() => api.importRemote({}, remote, f.names), /base contenant des données métier/)
  assert.equal(f.commands.length, 0)
  assert.ok(!fs.existsSync(path.join(f.root, '.env.storage.local')), 'no new credential profile after refusal')
})

test('concurrent Vercel mutation blocks the wipe', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel(), env = await api.importRemote({}, remote, f.names)
  f.current = { ...f.current, stamps: { ...f.current.stamps, NEXTAUTH_SECRET: 'changed-by-other-operator' } }
  await assert.rejects(() => api.syncVercel(env, f.names), /a changé pendant le plan/)
  assert.equal(f.commands.length, 0)
})

test('failed rewrite preserves new keys in a private journal, retry reuses them', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel(), env = await api.importRemote({}, remote, f.names)
  const tool = f.base.tool
  f.base.tool = async (program, args, options) => {
    if (args[1] === 'add') throw new Error('simulated provider outage')
    return tool(program, args, options)
  }
  await assert.rejects(() => api.syncVercel(env, f.names), /simulated provider outage/)
  const file = path.join(f.root, 'GarageFlow-configuration/rebuild-pending.json')
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(state.env.NEXTAUTH_SECRET, env.NEXTAUTH_SECRET)
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  f.base.tool = tool
  const retry = rebuild.automaticApi(f.base), nextRemote = await retry.setupVercel()
  const nextEnv = await retry.importRemote({}, nextRemote, f.names)
  assert.equal(nextEnv.NEXTAUTH_SECRET, env.NEXTAUTH_SECRET)
  await retry.syncVercel(nextEnv, f.names)
  assert.ok(!fs.existsSync(file))
  assert.ok(f.current.present.has('BLOB_READ_WRITE_TOKEN'), 'unknown provider values removed before failure are restored')
})

test('a changed linked project blocks apply', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel(), env = await api.importRemote({}, remote, f.names)
  fs.writeFileSync(path.join(f.root, '.vercel/project.json'), JSON.stringify({ orgId: 'team_other', projectId: 'prj_other' }))
  await assert.rejects(() => api.syncVercel(env, f.names), /Projet Vercel modifié/)
  assert.equal(f.commands.length, 0)
})

test('unknown secret credentials are not requested or fabricated', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  await assert.rejects(() => api.secretField({}, 'SMTP_PASSWORD'), /non récupérable automatiquement/)
  assert.equal(f.prompts, 0)
  assert.equal(await api.question('Saisir MIGRER'), '')
})

test('existing valid public domain is preserved rather than forcing another domain', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const env = { NEXTAUTH_URL: 'https://app.example.invalid' }
  await api.services.configureServerEndpoint(env)
  assert.equal(env.GF_APP_URL, env.NEXTAUTH_URL)
  assert.equal(f.prompts, 0)
})

test('service backup is bound to the linked project and never reused for another project', async t => {
  const f = fixture(t)
  const folder = path.join(f.root, 'GarageFlow-configuration')
  fs.mkdirSync(folder)
  core.writePrivate(path.join(folder, 'rebuild-sources.json'), JSON.stringify({ project: { orgId: 'team_other', projectId: 'prj_other' }, values: { DIRECT_URL: f.values.POSTGRES_URL_NON_POOLING } }))
  delete f.current.values.POSTGRES_URL_NON_POOLING
  const api = rebuild.automaticApi(f.base), remote = await api.setupVercel()
  await assert.rejects(() => api.importRemote({}, remote, f.names), /Accès Storage introuvables/)
})

test('known desktop/runtime/obsolete values are removed without republishing them to production', () => {
  const remote = { records: [{ key: 'GF_INTERNAL_EXPORT_KEY' }, { key: 'DATABASE_URL_UNPOOLED' }], values: {} }
  const plan = rebuild.planRebuild(remote, {}, [], [], ['GF_INTERNAL_EXPORT_KEY', 'DATABASE_URL_UNPOOLED'])
  assert.deepEqual(plan.remove, ['GF_INTERNAL_EXPORT_KEY', 'DATABASE_URL_UNPOOLED'])
  assert.deepEqual(plan.values, {})
})

test('business data arriving after preflight blocks the wipe at apply time', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel(), env = await api.importRemote({}, remote, f.names)
  api.services.inspectDatabase = async () => ({ empty: false })
  await assert.rejects(() => api.syncVercel(env, f.names), /données métier sont apparues/)
  assert.equal(f.commands.length, 0)
})

test('a failed final verification keeps the private pending journal instead of reporting success', async t => {
  const f = fixture(t), api = rebuild.automaticApi(f.base)
  const remote = await api.setupVercel(), env = await api.importRemote({}, remote, f.names)
  const originalPull = f.base.pullVercel
  let count = 0
  f.base.pullVercel = async () => {
    const result = await originalPull()
    if (count++ > 0) result.present.delete('NEXTAUTH_SECRET')
    return result
  }
  await assert.rejects(() => api.syncVercel(env, f.names), /Vérification après reconstruction échouée/)
  assert.ok(fs.existsSync(path.join(f.root, 'GarageFlow-configuration/rebuild-pending.json')))
  assert.ok(!fs.existsSync(path.join(f.root, 'GarageFlow-configuration/secrets-receipt.json')))
})

test('real PG parameters can build URLs with encoded credentials, never invent the direct host', () => {
  const fields = { PGHOST: 'ep-provider-pooler.neon.tech', PGUSER: 'user@tenant', PGPASSWORD: 'fake:a/b@pass', PGDATABASE: 'db/name' }
  const pooled = rebuild.normalizeStorage(fields)
  const url = new URL(pooled.DATABASE_URL)
  assert.equal(url.hostname, fields.PGHOST)
  assert.equal(decodeURIComponent(url.username), fields.PGUSER)
  assert.equal(decodeURIComponent(url.password), fields.PGPASSWORD)
  assert.equal(decodeURIComponent(url.pathname.slice(1)), fields.PGDATABASE)
  assert.equal(url.searchParams.get('sslmode'), 'require')
  assert.equal(pooled.DIRECT_URL, undefined)
  const withDirect = rebuild.normalizeStorage({ ...fields, PGHOST_UNPOOLED: 'ep-provider.neon.tech' })
  assert.equal(new URL(withDirect.DIRECT_URL).hostname, 'ep-provider.neon.tech')
  assert.equal(rebuild.normalizeStorage({ ...fields, PGPASSWORD: '' }).DATABASE_URL, undefined)
})

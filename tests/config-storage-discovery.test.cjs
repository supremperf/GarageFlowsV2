'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const core = require('../scripts/config-core.cjs')
const rebuild = require('../scripts/config-rebuild.cjs')
const decoder = require('../scripts/lib/config-vercel-env.cjs')
const wizard = require('../config')

const project = { projectId: 'prj_test', orgId: 'team_test' }
const credentials = {
  DATABASE_URL: 'postgresql://owner:fake-pass@ep-test-pooler.neon.tech/db?sslmode=require',
  DIRECT_URL: 'postgresql://owner:fake-pass@ep-test.neon.tech/db?sslmode=require',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'fake-redis-write-token',
}
function inventory(keys = Object.keys(credentials)) {
  return keys.map((key, i) => ({ id: `env_${i}`, key, type: 'sensitive', visibility: 'secret', target: ['production'], updatedAt: 7 }))
}
function remote(records = inventory(), values = {}) { return decoder.fromPull(records, values) }
function baseWith(handler) {
  const calls = []
  return { calls, tool: async (tool, args) => {
    assert.equal(tool, 'vercel')
    assert.equal(args[0], 'api', 'discovery must not mutate Vercel')
    const url = new URL('https://api.vercel.com' + args[1])
    assert.equal(url.searchParams.get('teamId'), project.orgId)
    calls.push(url)
    return JSON.stringify(await handler(url))
  } }
}
function unavailable(url) {
  if (url.pathname === '/v1/storage/stores') return { stores: [] }
  if (url.pathname.includes('/v10/projects/')) return { envs: [] }
  return { env: {} }
}

test('regression Windows: env pull returned four secrets; protection metadata must not discard them', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vercel-pull-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const records = inventory()
  const result = await wizard.pullVercel({ root, runTool: async (_tool, args) => {
    if (args[1] === 'ls') return JSON.stringify({ envs: records })
    assert.equal(args[1], 'pull')
    assert.ok(!fs.existsSync(args[2]), 'fresh file: no stale local credential preserved by the Vercel CLI')
    assert.ok(args.includes('--environment=production'))
    fs.writeFileSync(args[2], core.serializeEnv(credentials, Object.keys(credentials), 'test-production'))
    return ''
  } })
  assert.deepEqual(result.values, credentials)
  assert.equal(result.hidden.size, 0)
  assert.equal(fs.readdirSync(path.join(root, 'GarageFlow-configuration')).length, 0, 'temporary credentials removed')
})

test('empty values and Vercel [SENSITIVE] placeholders remain unknown; ciphertext metadata is never used', () => {
  const records = inventory().map(r => ({ ...r, value: 'CIPHERTEXT-NOT-A-CREDENTIAL' }))
  const result = remote(records, { DATABASE_URL: '[SENSITIVE]', DIRECT_URL: '', UPSTASH_REDIS_REST_TOKEN: '***' })
  assert.equal(result.hidden.size, 4)
  assert.deepEqual(result.values, {})
  assert.equal(rebuild.normalizeStorage({ DATABASE_URL: '[SENSITIVE]', KV_REST_API_TOKEN: '[SENSITIVE]' }).DATABASE_URL, undefined)
  assert.equal(rebuild.normalizeStorage({ PGHOST: 'db.example.invalid', PGUSER: 'owner', PGPASSWORD: '[SENSITIVE]', PGDATABASE: 'db' }).DATABASE_URL, undefined)
})

test('readable encrypted/secret values are accepted only from pull, not from env ls value', () => {
  const record = { key: 'DATABASE_URL', type: 'encrypted', visibility: 'secret', value: 'CIPHERTEXT' }
  assert.equal(remote([record], credentials).values.DATABASE_URL, credentials.DATABASE_URL)
  assert.equal(remote([record], {}).values.DATABASE_URL, undefined)
})

test('authenticated production pull API recovers masked values without touching Storage', async () => {
  const base = baseWith(url => {
    assert.equal(url.pathname, `/v3/env/pull/${project.projectId}/production`)
    return { env: credentials }
  })
  const result = await rebuild.recoverStorage(base, remote(), project)
  assert.deepEqual(result.values, credentials)
  assert.equal(base.calls.length, 1)
})

test('decrypted production listing can recover four values, no preview credential is selected', async () => {
  const base = baseWith(url => {
    if (url.pathname.includes('/v10/projects/')) {
      assert.equal(url.searchParams.get('target'), 'production')
      assert.equal(url.searchParams.get('decrypt'), 'true')
      return { envs: [
        ...inventory().map(r => ({ ...r, decrypted: true, value: credentials[r.key] })),
        { key: 'DATABASE_URL', target: ['development'], type: 'plain', value: 'postgresql://wrong:wrong@dev.invalid/dev' },
      ] }
    }
    return unavailable(url)
  })
  const result = await rebuild.recoverStorage(base, remote(), project)
  assert.deepEqual(result.values, credentials)
  assert.equal(base.calls.length, 2)
})

test('dedicated per-variable decryption uses the real env IDs and never imports listing ciphertext', async () => {
  const records = inventory()
  const base = baseWith(url => {
    if (url.pathname.includes('/v10/projects/')) return { envs: records.map(r => ({ ...r, decrypted: false, value: 'CIPHERTEXT' })) }
    const r = records.find(r => url.pathname.endsWith(`/env/${r.id}`))
    if (r) return { ...r, decrypted: true, value: credentials[r.key] }
    return unavailable(url)
  })
  const result = await rebuild.recoverStorage(base, remote(records), project)
  assert.deepEqual(result.values, credentials)
  assert.equal(result.hidden.size, 0)
})

test('wrong target/key, ciphertext or placeholder from per-variable API is refused', async () => {
  const records = inventory()
  const base = baseWith(url => {
    const r = records.find(r => url.pathname.endsWith(`/env/${r.id}`))
    if (!r) return unavailable(url)
    if (r.key === 'DATABASE_URL') return { ...r, key: 'OTHER_KEY', value: credentials[r.key] }
    if (r.key === 'DIRECT_URL') return { ...r, target: ['preview'], value: credentials[r.key] }
    if (r.key === 'UPSTASH_REDIS_REST_URL') return { ...r, decrypted: false, value: credentials[r.key] }
    return { ...r, value: '[SENSITIVE]' }
  })
  const result = await rebuild.recoverStorage(base, remote(records), project)
  assert.deepEqual(result.values, {})
  assert.equal(result.hidden.size, 4)
})

test('one official reauthentication is attempted when sensitive reads are denied; then the project is reread', async () => {
  let authenticated = false, logins = 0
  const base = baseWith(url => {
    if (authenticated && url.pathname.includes('/v3/env/pull/')) return { env: credentials }
    if (url.pathname.includes('/v10/projects/')) return { envs: inventory(), hiddenProductionEnvCount: 4 }
    return { error: { code: 'challenge_required', message: 'provider error containing fake-sensitive-data must not be logged' } }
  })
  base.refreshVercelAuth = async () => { logins++; authenticated = true }
  const result = await rebuild.recoverStorage(base, remote(), project)
  assert.equal(logins, 1)
  assert.deepEqual(result.values, credentials)
})

test('failed reauthentication is not an infinite login loop and does not mutate resources', async () => {
  let logins = 0
  const base = baseWith(url => {
    if (url.pathname.includes('/v10/projects/')) return { envs: inventory(), hiddenProductionEnvCount: 4 }
    return unavailable(url)
  })
  base.refreshVercelAuth = async () => { logins++; throw new Error('fake credential in provider error') }
  const result = await rebuild.recoverStorage(base, remote(), project)
  assert.equal(logins, 1)
  assert.deepEqual(result.values, {})
})

test('native Postgres/Redis hints recover prefixed names without requiring type=integration', async () => {
  const definitions = [
    ['DB_POOL', 'store_pg', 'postgres-url', credentials.DATABASE_URL],
    ['DB_DIRECT', 'store_pg', 'postgres-url-non-pooling', credentials.DIRECT_URL],
    ['CACHE_ENDPOINT', 'store_redis', 'redis-rest-api-url', credentials.UPSTASH_REDIS_REST_URL],
    ['CACHE_TOKEN', 'store_redis', 'redis-rest-api-token', credentials.UPSTASH_REDIS_REST_TOKEN],
  ]
  const records = definitions.map(([key, storeId, type], i) => ({ key, id: `env_${i}`, target: ['production'], contentHint: { storeId, type } }))
  const values = Object.fromEntries(definitions.map(([key, _store, _type, value]) => [key, value]))
  const base = baseWith(url => {
    if (url.pathname === '/v1/storage/stores') return { stores: [{ id: 'store_pg', type: 'postgres' }, { id: 'store_redis', type: 'redis' }] }
    if (/\/stores\/store_/.test(url.pathname)) return { store: { projectsMetadata: [{ projectId: project.projectId, environments: ['production'] }] } }
    return unavailable(url)
  })
  const result = await rebuild.recoverStorage(base, remote(records, values), project)
  for (const [key, value] of Object.entries(credentials)) assert.equal(result.values[key], value, key)
})

test('integration prefixes are discovered from project connections missing in the store list', async () => {
  const values = { NEON_POSTGRES_URL: credentials.DATABASE_URL, NEON_POSTGRES_URL_NON_POOLING: credentials.DIRECT_URL,
    CACHE_KV_REST_API_URL: credentials.UPSTASH_REDIS_REST_URL, CACHE_KV_REST_API_TOKEN: credentials.UPSTASH_REDIS_REST_TOKEN }
  const records = Object.keys(values).map(key => ({ key, target: ['production'] }))
  const base = baseWith(url => {
    if (url.pathname === '/v1/storage/stores') return { stores: [{ id: 'pg' }, { id: 'kv' }, { id: 'other' }] }
    if (url.pathname.endsWith('/connections')) {
      const id = url.pathname.split('/')[4]
      const prefix = id === 'pg' ? 'NEON' : 'CACHE'
      return { connections: [{ projectId: id === 'other' ? 'prj_other' : project.projectId, envVarPrefix: prefix,
        envVarEnvironments: ['production'] }] }
    }
    if (url.pathname.startsWith('/v1/storage/stores/')) return { store: {} }
    return unavailable(url)
  })
  const result = await rebuild.recoverStorage(base, remote(records, values), project)
  for (const [key, value] of Object.entries(credentials)) assert.equal(result.values[key], value, key)
})

test('multiple Postgres resources never lead to a mixed database/direct URL pair', async () => {
  const records = [
    { key: 'FIRST_URL', target: ['production'], contentHint: { storeId: 'first', type: 'postgres-url' } },
    { key: 'SECOND_DIRECT', target: ['production'], contentHint: { storeId: 'second', type: 'postgres-url-non-pooling' } },
  ]
  const base = baseWith(unavailable)
  const result = await rebuild.recoverStorage(base, remote(records, { FIRST_URL: credentials.DATABASE_URL, SECOND_DIRECT: credentials.DIRECT_URL }), project)
  assert.equal(result.values.DATABASE_URL, undefined)
  assert.equal(result.values.DIRECT_URL, undefined)
})

test('development-only Storage connection never supplies production credentials', async () => {
  const values = { DEV_DATABASE_URL: credentials.DATABASE_URL, DEV_DIRECT_URL: credentials.DIRECT_URL }
  const records = Object.keys(values).map(key => ({ key, target: ['development'] }))
  const base = baseWith(url => url.pathname === '/v1/storage/stores' ? { stores: [{ id: 'dev', projectsMetadata: [{ projectId: project.projectId,
    environments: ['development'], envVarPrefix: 'DEV', environmentVariables: Object.keys(values) }] }] } : unavailable(url))
  const result = await rebuild.recoverStorage(base, remote(records, values), project)
  assert.equal(result.values.DATABASE_URL, undefined)
})

test('discovery diagnostics never print a credential or a raw provider error', async () => {
  const messages = [], original = console.log
  console.log = (...args) => messages.push(args.join(' '))
  try {
    const base = baseWith(() => ({ error: { message: 'fake-password-that-must-remain-hidden' } }))
    await rebuild.recoverStorage(base, remote(), project)
    const output = messages.join('\n')
    assert.match(output, /Découverte Vercel production/)
    assert.match(output, /Storage :/)
    assert.doesNotMatch(output, /fake-password-that-must-remain-hidden/)
    for (const value of Object.values(credentials)) assert.ok(!output.includes(value))
  } finally { console.log = original }
})

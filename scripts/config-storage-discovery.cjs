'use strict'
const envs = require('./lib/config-vercel-env.cjs')
const api = require('./lib/config-vercel-api.cjs')

// Public Vercel endpoints used by the pinned CLI and @vercel/sdk. All requests
// are authenticated by the official CLI and scoped to the selected team/project.
const HINTS = {
  'postgres-url': 'POSTGRES_URL', 'postgres-prisma-url': 'POSTGRES_PRISMA_URL',
  'postgres-url-non-pooling': 'POSTGRES_URL_NON_POOLING',
  'postgres-host': 'PGHOST', 'postgres-user': 'PGUSER',
  'postgres-password': 'PGPASSWORD', 'postgres-database': 'PGDATABASE',
  'redis-rest-api-url': 'KV_REST_API_URL', 'redis-rest-api-token': 'KV_REST_API_TOKEN',
  'redis-rest-api-read-only-token': 'KV_REST_API_READ_ONLY_TOKEN',
  'blob-read-write-token': 'BLOB_READ_WRITE_TOKEN',
}
const PROVIDER_KEY = /(?:^|_)(?:DATABASE_URL(?:_UNPOOLED)?|DIRECT_URL|POSTGRES_\w+|PGHOST(?:_UNPOOLED)?|PGUSER|PGPASSWORD|PGDATABASE|PGPORT|KV_\w+|UPSTASH_\w+|REDIS_URL|BLOB_\w+)$/
function complete(remote, normalize, required) { return required.every(n => envs.readable(normalize(remote.values)[n])) }
function scopedPath(path, project, extra = {}) {
  return `${path}?${new URLSearchParams({ teamId: project.orgId, ...extra })}`
}
async function get(base, path) {
  // CLI 64 throws non-2xx responses before --include prints their headers.
  // Its debug request-status line is captured privately and reduced to a
  // numeric status on failure; no debug text is forwarded or persisted.
  return api.decode(await base.tool('vercel', ['api', path, '--include', '--raw', '--debug'], { captureVercelApiFailure: true }))
}
function secretRecord(r) { return r.contentHint?.storeId || PROVIDER_KEY.test(r.key || '') }
function usableRecord(r) { return typeof r.key === 'string' && !r.gitBranch && (!r.target || envs.production(r)) }
function mapStorage(remote, metadata, connections, normalize, aliases) {
  const groups = new Map()
  const group = id => { if (!groups.has(id)) groups.set(id, {}); return groups.get(id) }
  for (const r of metadata) {
    const value = remote.values[r.key]
    if (!envs.readable(value) || !usableRecord(r)) continue
    const storeId = r.contentHint?.storeId
    if (storeId && HINTS[r.contentHint.type]) group(storeId)[HINTS[r.contentHint.type]] = value
    if (storeId && PROVIDER_KEY.test(r.key)) {
      const keys = [...new Set(Object.values(aliases).flat())].sort((a, b) => b.length - a.length)
      const key = keys.find(n => r.key === n || r.key.endsWith(`_${n}`))
      if (key) group(storeId)[key] = value
    }
  }
  for (const connection of connections) {
    if (!connection.production) continue
    const prefix = String(connection.prefix || '').replace(/_+$/, '')
    if (!prefix) continue
    for (const key of connection.keys) {
      if (!key.startsWith(`${prefix}_`) || !envs.readable(remote.values[key])) continue
      group(connection.storeId)[key.slice(prefix.length + 1)] = remote.values[key]
    }
  }
  const normalizedGroups = [...groups.values()].map(normalize)
  const recovered = {}
  // More than one database or Redis resource is not a reason to mix credentials.
  for (const family of [['DATABASE_URL', 'DIRECT_URL'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']]) {
    const candidates = normalizedGroups.filter(g => family.some(n => envs.readable(g[n])))
    if (candidates.length > 1) continue
    for (const name of family) if (candidates.length && !envs.readable(remote.values[name]) && envs.readable(candidates[0][name])) recovered[name] = candidates[0][name]
  }
  return envs.attach(remote, recovered)
}

async function discover(base, remote, project, { normalize, required, aliases }) {
  let result = remote, metadata = [...(remote.records || [])], authNeeded = false
  const diagnostics = { pull: 'non tenté', list: 'non tenté', reads: 0, denied: 0, stores: 0, linked: 0, details: 0, connections: 0, incomplete: 0 }
  let attempt = 'initial'
  const events = [], resources = [], authentication = { attempted: false, outcome: 'not_needed' }
  const recordFailure = (stage, error, extra = {}) => {
    const details = api.safeFailure(error?.vercelApi)
    events.push({ stage, attempt, ...extra, ...details })
    if (['auth_challenge', 'authentication_required'].includes(details.reason)) authNeeded = true
  }
  const finish = () => {
    const found = required.filter(n => envs.readable(normalize(result.values)[n]))
    const missing = required.filter(n => !found.includes(n))
    console.log(`Découverte Vercel production : pull API ${diagnostics.pull} ; liste déchiffrée ${diagnostics.list} ; lectures ciblées réussies ${diagnostics.reads}, non exploitables ${diagnostics.denied} (pas nécessairement des refus HTTP).`)
    if (missing.length || diagnostics.stores) console.log(`Storage : ${diagnostics.stores} ressources inventoriées, ${diagnostics.linked} liées au projet, ${diagnostics.details} détails et ${diagnostics.connections} connexions lus, ${diagnostics.incomplete} accès incomplets. Aucun rattachement, détachement ou effacement.`)
    console.log(`Connexions reconnues (noms seulement) : ${found.join(', ') || 'aucune'}.`)
    const reasons = {}
    for (const event of events.filter(e => e.reason)) reasons[event.reason] = (reasons[event.reason] || 0) + 1
    if (Object.keys(reasons).length) console.log(`Causes filtrées (toutes étapes) : ${Object.entries(reasons).map(([name, count]) => `${name}=${count}`).join(', ')}.`)
    if (reasons.auth_challenge) console.log('Vercel demande une authentification renforcée ; un simple login ne garantit pas la validation de ce challenge. Aucun contournement tenté.')
    return { ...result, discovery: { schema: 2, project, stages: { ...diagnostics }, authentication, reasons, events, resources, found, missing } }
  }
  if (complete(result, normalize, required)) return finish()
  const readProject = async () => {
    try {
      const body = await get(base, scopedPath(`/v3/env/pull/${encodeURIComponent(project.projectId)}/production`, project, { source: 'vercel-cli:env:pull' }))
      if (!body.env || Array.isArray(body.env) || typeof body.env !== 'object') throw api.failure('unexpected_response', { httpStatus: api.status(body) })
      result = envs.attach(result, body.env)
      diagnostics.pull = 'lu'
      const providerValues = Object.entries(body.env).filter(([key]) => PROVIDER_KEY.test(key)).map(([, value]) => value)
      events.push({ stage: 'pull', attempt, outcome: 'read', httpStatus: api.status(body), providerValues: providerValues.length,
        readableValues: providerValues.filter(envs.readable).length,
        maskedValues: providerValues.filter(value => typeof value === 'string' && value.trim() && !envs.readable(value)).length })
    } catch (error) { diagnostics.pull = 'indisponible (voir events)'; recordFailure('pull', error) }
    if (complete(result, normalize, required)) return
    try {
      const body = await get(base, scopedPath(`/v10/projects/${encodeURIComponent(project.projectId)}/env`, project,
        { target: 'production', decrypt: 'true', source: 'vercel-cli:env:pull' }))
      if (!Array.isArray(body.envs) || body.envs.some(r => !r || typeof r !== 'object')) throw api.failure('unexpected_response', { httpStatus: api.status(body) })
      if (body.pagination?.next) throw api.failure('incomplete_response', { httpStatus: api.status(body) })
      const production = body.envs.filter(envs.production)
      const byKey = new Map(metadata.map(r => [r.key, r]))
      for (const r of production) {
        byKey.set(r.key, r)
        if ((r.decrypted === true || r.type === 'plain') && envs.readable(r.value)) result = envs.attach(result, { [r.key]: r.value })
      }
      metadata = [...byKey.values()]
      authNeeded ||= body.hiddenProductionEnvCount > 0
      diagnostics.list = 'lu'
      events.push({ stage: 'list', attempt, outcome: 'read', httpStatus: api.status(body), productionRecords: production.length,
        decryptedRecords: production.filter(r => r.decrypted === true).length,
        hiddenProductionEnvCount: Number.isInteger(body.hiddenProductionEnvCount) ? body.hiddenProductionEnvCount : null })
    } catch (error) { diagnostics.list = 'indisponible (voir events)'; recordFailure('list', error) }
    if (complete(result, normalize, required)) return
    for (const r of metadata.filter(r => r.id && usableRecord(r) && secretRecord(r) && !envs.readable(result.values[r.key]))) {
      let response = null
      try {
        const body = await get(base, scopedPath(`/v1/projects/${encodeURIComponent(project.projectId)}/env/${encodeURIComponent(r.id)}`, project))
        response = body
        const unreadable = reason => api.failure(reason, { httpStatus: api.status(body) })
        if (typeof body.key !== 'string') throw unreadable('unexpected_response')
        if (body.key !== r.key) throw unreadable('wrong_key')
        if (!usableRecord(body)) throw unreadable('wrong_target')
        if (body.decrypted === false) throw unreadable('not_decrypted')
        if (body.value === undefined || body.value === null || body.value === '') throw unreadable('missing_value')
        if (typeof body.value !== 'string') throw unreadable('unexpected_response')
        if (!envs.readable(body.value)) throw unreadable(body.value.trim() ? 'masked_value' : 'missing_value')
        result = envs.attach(result, { [r.key]: body.value })
        diagnostics.reads++
      } catch (error) {
        diagnostics.denied++
        recordFailure('read', error, { key: /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(r.key) ? r.key : '(non-standard)',
          type: ['sensitive', 'encrypted', 'secret', 'plain', 'system'].includes(r.type) ? r.type : null,
          visibility: ['secret', 'config'].includes(r.visibility) ? r.visibility : null,
          response: response ? { keyPresent: Object.hasOwn(response, 'key'), valuePresent: Object.hasOwn(response, 'value'),
            valueType: response.value === null ? 'null' : typeof response.value,
            decrypted: typeof response.decrypted === 'boolean' ? response.decrypted : null,
            envWrapper: Object.hasOwn(response, 'env') } : null })
      }
    }
  }
  await readProject()
  if (complete(result, normalize, required)) return finish()
  if (authNeeded && base.refreshVercelAuth) {
    console.log('Vercel signale une authentification requise ou des variables cachées. Une seule reconnexion officielle sera tentée ; elle ne garantit pas le déchiffrement.')
    authentication.attempted = true
    authentication.outcome = 'failed'
    try {
      await base.refreshVercelAuth()
      authentication.outcome = 'login_completed'
      attempt = 'after_login'
      // Keep the original concurrency stamps; reread after login without assuming
      // that a context-specific MFA challenge or export permission was granted.
      await readProject()
    } catch { console.log('Vercel : authentification récente non obtenue ; aucun secret inventé.') }
    if (complete(result, normalize, required)) return finish()
  }
  if (authNeeded && !base.refreshVercelAuth) authentication.outcome = 'unavailable'
  attempt = 'inventory'
  const connections = []
  try {
    const body = await get(base, scopedPath('/v1/storage/stores', project))
    if (!Array.isArray(body.stores)) throw api.failure('unexpected_response', { httpStatus: api.status(body) })
    diagnostics.stores = body.stores.length
    for (const listed of body.stores) {
      if (!listed.id) continue
      let store = listed
      if (!Array.isArray(store.projectsMetadata)) {
        try {
          const detail = await get(base, scopedPath(`/v1/storage/stores/${encodeURIComponent(store.id)}`, project))
          store = { ...listed, ...detail.store }; diagnostics.details++
        } catch (error) { diagnostics.incomplete++; recordFailure('store-detail', error) }
      }
      let linked = store.projectsMetadata?.find(p => p.projectId === project.projectId)
      const hinted = metadata.some(r => r.contentHint?.storeId === listed.id && usableRecord(r))
      if (!linked && !hinted) {
        // Legacy Postgres/Redis resources are not necessarily type=integration,
        // nor is projectsMetadata guaranteed to be present in the list response.
        try {
          const data = await get(base, scopedPath(`/v1/storage/stores/${encodeURIComponent(listed.id)}/connections`, project))
          linked = data.connections?.find(p => p.projectId === project.projectId)
          diagnostics.connections++
        } catch (error) { diagnostics.incomplete++; recordFailure('store-connections', error) }
      }
      if (!linked && !hinted) continue
      diagnostics.linked++
      const environments = linked?.environments || linked?.envVarEnvironments || []
      resources.push({ type: ['postgres', 'redis', 'blob', 'integration'].includes(store.type) ? store.type : 'other',
        production: hinted || environments.includes('production'),
        makeEnvVarsSensitive: typeof linked?.makeEnvVarsSensitive === 'boolean' ? linked.makeEnvVarsSensitive : null })
      connections.push({ storeId: listed.id, prefix: linked?.envVarPrefix, keys: Array.isArray(linked?.environmentVariables) ? linked.environmentVariables.filter(k => typeof k === 'string')
          : metadata.filter(r => usableRecord(r) && typeof r.key === 'string' && r.key.startsWith(`${String(linked?.envVarPrefix || '').replace(/_+$/, '')}_`)).map(r => r.key),
        production: hinted || environments.includes('production') })
    }
  } catch (error) { diagnostics.incomplete++; recordFailure('stores', error) }
  result = mapStorage(result, metadata, connections, normalize, aliases)
  // env list is intentionally not a ciphertext fallback. All values used above
  // come from the authenticated pull or dedicated decryption endpoint.
  return finish()
}
module.exports = { discover, mapStorage }

'use strict'
const envs = require('./lib/config-vercel-env.cjs')

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
  const body = JSON.parse(await base.tool('vercel', ['api', path]))
  if (!body || typeof body !== 'object' || body.error) throw new Error('Vercel API indisponible')
  return body
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
  const finish = () => {
    const found = required.filter(n => envs.readable(normalize(result.values)[n]))
    const missing = required.filter(n => !found.includes(n))
    console.log(`Découverte Vercel production : pull API ${diagnostics.pull} ; liste déchiffrée ${diagnostics.list} ; lectures ciblées ${diagnostics.reads}, refus/valeurs masquées ${diagnostics.denied}.`)
    if (missing.length || diagnostics.stores) console.log(`Storage : ${diagnostics.stores} ressources inventoriées, ${diagnostics.linked} liées au projet, ${diagnostics.details} détails et ${diagnostics.connections} connexions lus, ${diagnostics.incomplete} accès incomplets. Aucun rattachement, détachement ou effacement.`)
    console.log(`Connexions reconnues (noms seulement) : ${found.join(', ') || 'aucune'}.`)
    return { ...result, discovery: { schema: 1, project, stages: { ...diagnostics }, found, missing } }
  }
  if (complete(result, normalize, required)) return finish()
  const readProject = async () => {
    try {
      const body = await get(base, scopedPath(`/v3/env/pull/${encodeURIComponent(project.projectId)}/production`, project, { source: 'vercel-cli:env:pull' }))
      if (!body.env || Array.isArray(body.env) || typeof body.env !== 'object') throw new Error()
      result = envs.attach(result, body.env)
      diagnostics.pull = 'lu'
    } catch { diagnostics.pull = 'indisponible (session/droits/réseau)' }
    if (complete(result, normalize, required)) return
    try {
      const body = await get(base, scopedPath(`/v10/projects/${encodeURIComponent(project.projectId)}/env`, project,
        { target: 'production', decrypt: 'true', source: 'vercel-cli:env:pull' }))
      if (!Array.isArray(body.envs) || body.pagination?.next) throw new Error()
      const production = body.envs.filter(envs.production)
      const byKey = new Map(metadata.map(r => [r.key, r]))
      for (const r of production) {
        byKey.set(r.key, r)
        if ((r.decrypted === true || r.type === 'plain') && envs.readable(r.value)) result = envs.attach(result, { [r.key]: r.value })
      }
      metadata = [...byKey.values()]
      authNeeded ||= body.hiddenProductionEnvCount > 0
      diagnostics.list = 'lu'
    } catch { diagnostics.list = 'indisponible (session/droits/réseau)' }
    if (complete(result, normalize, required)) return
    for (const r of metadata.filter(r => r.id && usableRecord(r) && secretRecord(r) && !envs.readable(result.values[r.key]))) {
      try {
        const body = await get(base, scopedPath(`/v1/projects/${encodeURIComponent(project.projectId)}/env/${encodeURIComponent(r.id)}`, project))
        if (body.key !== r.key || !usableRecord(body) || body.decrypted === false || !envs.readable(body.value)) throw new Error()
        result = envs.attach(result, { [r.key]: body.value })
        diagnostics.reads++
      } catch {
        diagnostics.denied++
        if (r.type === 'sensitive' || r.visibility === 'secret') authNeeded = true
      }
    }
  }
  await readProject()
  if (complete(result, normalize, required)) return finish()
  if (authNeeded && base.refreshVercelAuth) {
    console.log('Vercel : une authentification récente peut être requise pour lire les secrets. Connexion officielle, sans saisie de variable applicative.')
    try {
      await base.refreshVercelAuth()
      // Keep the original concurrency stamps; this only grants read access.
      await readProject()
    } catch { console.log('Vercel : authentification récente non obtenue ; aucun secret inventé.') }
    if (complete(result, normalize, required)) return finish()
  }
  const connections = []
  try {
    const body = await get(base, scopedPath('/v1/storage/stores', project))
    if (!Array.isArray(body.stores)) throw new Error()
    diagnostics.stores = body.stores.length
    for (const listed of body.stores) {
      if (!listed.id) continue
      let store = listed
      if (!Array.isArray(store.projectsMetadata)) {
        try {
          const detail = await get(base, scopedPath(`/v1/storage/stores/${encodeURIComponent(store.id)}`, project))
          store = { ...listed, ...detail.store }; diagnostics.details++
        } catch { diagnostics.incomplete++ }
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
        } catch { diagnostics.incomplete++ }
      }
      if (!linked && !hinted) continue
      diagnostics.linked++
      const environments = linked?.environments || linked?.envVarEnvironments || []
      connections.push({ storeId: listed.id, prefix: linked?.envVarPrefix, keys: Array.isArray(linked?.environmentVariables) ? linked.environmentVariables.filter(k => typeof k === 'string')
          : metadata.filter(r => usableRecord(r) && typeof r.key === 'string' && r.key.startsWith(`${String(linked?.envVarPrefix || '').replace(/_+$/, '')}_`)).map(r => r.key),
        production: hinted || environments.includes('production') })
    }
  } catch { diagnostics.incomplete++ }
  result = mapStorage(result, metadata, connections, normalize, aliases)
  // env list is intentionally not a ciphertext fallback. All values used above
  // come from the authenticated pull or dedicated decryption endpoint.
  return finish()
}
module.exports = { discover, mapStorage }

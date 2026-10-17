'use strict'
function failure(message) { const error = new Error(message); error.configSafe = true; return error }
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const core = require('../config-core.cjs')
const codec = require('./config-vercel-api.cjs')
const decoder = require('./config-vercel-env.cjs')
const { normalizeStorage, STORAGE_ALIASES } = require('../config-rebuild.cjs')
const BLOB_DIAGNOSTICS = Object.freeze({
  token_exposed: 'Token Blob précédemment exposé : le révoquer dans Vercel Blob et saisir un token renouvelé, sans le partager en conversation.',
  token_format: 'Format du token Blob non reconnu. Coller le token complet ou BLOB_READ_WRITE_TOKEN="valeur".',
  stores_inventory: 'Inventaire Blob Vercel inaccessible ou incomplet : vérifier la session Vercel et les droits de l’équipe. Cela ne prouve pas que le token est invalide.',
  store_association: 'Aucun store Blob confirmé pour ce projet et cet environnement. Dans Vercel > Storage > store > Connect Project, vérifier le projet et cocher cette cible (Development, Preview ou Production). Aucun rattachement automatique.',
  token_store_mismatch: 'Le token ne correspond à aucun store Blob dont l’association avec ce projet/environnement a pu être confirmée. Vérifier le store émetteur et sa connexion à cette cible.',
  access_denied: 'L’API Blob refuse l’accès : vérifier le token renouvelé et ses permissions de lecture/liste.',
  store_not_found: 'L’API Blob ne trouve pas le store de ce token. Vérifier le store et renouveler son token si nécessaire.',
  store_suspended: 'Le store Blob est suspendu côté fournisseur. Vérifier son statut/facturation ; ressaisir le même token ne corrigera pas cela.',
  service_unavailable: 'Service Blob indisponible ou limité temporairement. Réessayer plus tard, sans remplacer le token.',
  request_failed: 'Connexion ou réponse Blob non confirmée. Vérifier réseau/proxy/pare-feu et disponibilité du service ; cela ne prouve pas que le token est invalide.',
  api_override: 'Blob : override d’API refusé pour protéger le token. Retirer VERCEL_BLOB_API_URL/NEXT_PUBLIC_VERCEL_BLOB_API_URL.',
})
const BLOB_TOKEN_ERRORS = new Set(['token_exposed', 'token_format', 'token_store_mismatch', 'access_denied', 'store_not_found'])
const BLOB_SDK_ERRORS = Object.freeze({ BlobAccessError: 'access_denied', BlobClientTokenExpiredError: 'access_denied',
  BlobStoreNotFoundError: 'store_not_found', BlobStoreSuspendedError: 'store_suspended',
  BlobServiceNotAvailable: 'service_unavailable', BlobServiceRateLimited: 'service_unavailable' })
function blobFailure(code) {
  const error = failure(BLOB_DIAGNOSTICS[code])
  error.configBlobCode = code
  return error
}
const TARGETS = ['development', 'preview', 'production']
const validName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !['constructor', 'prototype', '__proto__'].includes(name)
const targets = record => Array.isArray(record.target) ? record.target : [record.target]
const stamp = record => JSON.stringify([record.id, record.key, record.target, record.gitBranch, record.customEnvironmentIds, record.updatedAt, record.createdAt, record.type, record.visibility, record.comment === undefined ? null : crypto.createHash('sha256').update(String(record.comment)).digest('hex'), record.configurationId, record.integrationId, record.contentHint])
function recordsFor(records, target) {
  if (!Array.isArray(records) || records.some(r => !r || !validName(r.key) || typeof r.id !== 'string')) throw failure('Vercel : inventaire invalide ; aucune mutation.')
  const selected = records.filter(r => targets(r).includes(target) && !r.gitBranch && !r.customEnvironmentIds?.length)
  if (new Set(selected.map(r => r.key)).size !== selected.length) throw failure('Vercel : doublons dans une cible ; aucune mutation.')
  return selected
}
function protectedRecord(record, platform = []) {
  return record.type === 'system' || !!record.configurationId || !!record.integrationId || !!record.contentHint?.storeId || platform.includes(record.key)
}
function resourceAliases(records, values) {
  const hints = { 'postgres-url': 'POSTGRES_URL', 'postgres-prisma-url': 'POSTGRES_PRISMA_URL',
    'postgres-url-non-pooling': 'POSTGRES_URL_NON_POOLING', 'postgres-host': 'PGHOST',
    'postgres-user': 'PGUSER', 'postgres-password': 'PGPASSWORD', 'postgres-database': 'PGDATABASE',
    'redis-rest-api-url': 'KV_REST_API_URL', 'redis-rest-api-token': 'KV_REST_API_TOKEN', 'blob-read-write-token': 'BLOB_READ_WRITE_TOKEN' }
  const groups = new Map(), aliases = [...Object.values(STORAGE_ALIASES).flat(), 'BLOB_READ_WRITE_TOKEN'].sort((a, b) => b.length - a.length)
  for (const r of records) {
    const id = r.contentHint?.storeId
    if (!id || !decoder.readable(values[r.key])) continue
    const key = hints[r.contentHint.type] || aliases.find(key => r.key === key || r.key.endsWith(`_${key}`))
    if (!key) continue
    if (!groups.has(id)) groups.set(id, {})
    groups.get(id)[key] = values[r.key]
  }
  const result = { ...values }, normalized = [...groups.values()].map(normalizeStorage)
  for (const family of [['DATABASE_URL', 'DIRECT_URL'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['BLOB_READ_WRITE_TOKEN']]) {
    const matches = normalized.filter(g => family.some(key => decoder.readable(g[key])))
    if (matches.length !== 1) continue
    for (const key of family) if (!result[key] && matches[0][key]) result[key] = matches[0][key]
  }
  // A single prefixed token from this target can be a candidate even when
  // Vercel omits contentHint. Association is STILL mandatory in probeBlob.
  if (!decoder.readable(result.BLOB_READ_WRITE_TOKEN)) {
    const candidates = [...new Set(records.filter(r => r.key.endsWith('_BLOB_READ_WRITE_TOKEN') && decoder.readable(values[r.key])).map(r => values[r.key]))]
    if (candidates.length === 1) result.BLOB_READ_WRITE_TOKEN = candidates[0]
  }
  return result
}
function cloud(api) {
  const root = api.root
  const route = (project, suffix, query = {}) => `${suffix}?${new URLSearchParams({ teamId: project.orgId, ...query })}`
  const get = async (project, endpoint, query) => codec.decode(await api.tool('vercel', ['api', route(project, endpoint, query), '--include', '--raw', '--debug'], { captureVercelApiFailure: true }))
  async function connect({ dryRun = false } = {}) {
    let project
    const read = () => JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'))
    try { project = read() } catch { /* no automatic project guessing */ }
    if (!project && !dryRun && await api.yes('Projet Vercel non lié : ouvrir la sélection officielle du projet')) {
      await api.tool('vercel', ['link'], { interactive: true }); project = read()
    }
    if (!project || !/^prj_[A-Za-z0-9_-]+$/.test(project.projectId || '') || !/^(?:team_|user_)[A-Za-z0-9_-]+$/.test(project.orgId || '')) throw failure('Vercel : projet/équipe non liés ou invalides. Sélection explicite requise.')
    try { await api.tool('vercel', ['whoami']) }
    catch {
      if (dryRun) throw failure('Simulation : session Vercel absente ; aucun login déclenché.')
      await api.tool('vercel', ['login'], { interactive: true }); await api.tool('vercel', ['whoami'])
    }
    const confirmed = await get(project, `/v9/projects/${encodeURIComponent(project.projectId)}`)
    if (confirmed.id !== project.projectId || confirmed.accountId !== project.orgId) throw failure('Vercel : identité projet/équipe non confirmée par le serveur.')
    return { projectId: project.projectId, orgId: project.orgId }
  }
  async function read(project, target) {
    if (!TARGETS.includes(target)) throw failure('Vercel : environnement invalide.')
    const endpoint = `/v10/projects/${encodeURIComponent(project.projectId)}/env`
    const listing = await get(project, endpoint, { target, decrypt: 'true', source: 'vercel-cli:env:pull' })
    if (listing.pagination?.next) throw failure('Vercel : inventaire paginé incomplet ; aucune mutation.')
    const records = recordsFor(listing.envs, target)
    const values = {}
    let pull = 'unavailable'
    try {
      const body = await get(project, `/v3/env/pull/${encodeURIComponent(project.projectId)}/${target}`, { source: 'vercel-cli:env:pull' })
      if (!body.env || Array.isArray(body.env) || typeof body.env !== 'object') throw failure()
      // Never import a branch/custom-environment value outside this inventory.
      for (const r of records) if (decoder.readable(body.env[r.key])) values[r.key] = body.env[r.key]
      pull = 'read'
    } catch { /* listing and targeted reads may still grant authorized access */ }
    for (const r of records) {
      if (decoder.readable(values[r.key])) continue
      if ((r.decrypted === true || r.type === 'plain') && decoder.readable(r.value)) { values[r.key] = r.value; continue }
      try {
        const body = await get(project, `/v1/projects/${encodeURIComponent(project.projectId)}/env/${encodeURIComponent(r.id)}`)
        if (body.key === r.key && (!body.target || targets(body).includes(target)) && !body.gitBranch && !body.customEnvironmentIds?.length && body.decrypted !== false && decoder.readable(body.value)) values[r.key] = body.value
      } catch { /* masked is not absent; retain metadata and request an original */ }
    }
    return { records: records.map(r => { const { value, legacyValue, vsmValue, ...metadata } = r; return metadata }), values: resourceAliases(records, values), pull,
      branchOverrides: listing.envs.filter(r => targets(r).includes(target) && (r.gitBranch || r.customEnvironmentIds?.length)).length }
  }
  async function write(project, target, operation, { authorized = false } = {}) {
    if (!authorized || !TARGETS.includes(target) || !validName(operation.key) || (operation.record && protectedRecord(operation.record))) throw failure('Vercel : écriture sans plan autorisé refusée.')
    let method, endpoint, body
    const prefix = `/v10/projects/${encodeURIComponent(project.projectId)}/env`
    if (operation.kind === 'create') { method = 'POST'; endpoint = prefix }
    else if (['update', 'remove'].includes(operation.kind) && operation.record?.id && targets(operation.record).length === 1 && targets(operation.record)[0] === target && !operation.record.gitBranch && !operation.record.customEnvironmentIds?.length) {
      method = operation.kind === 'remove' ? 'DELETE' : 'PATCH'; endpoint = `${prefix}/${encodeURIComponent(operation.record.id)}`
    } else throw failure('Vercel : mutation multienvironnement/branche ou opération invalide refusée.')
    if (method !== 'DELETE') body = { key: operation.key, value: operation.value, type: operation.type || 'encrypted', target: [target], ...(operation.ownership || operation.comment !== undefined ? { comment: operation.ownership || operation.comment } : {}) }
    const args = ['api', route(project, endpoint), '--method', method, '--raw']
    let temporary
    try {
      if (body) {
        fs.mkdirSync(path.join(root, 'GarageFlow-configuration'), { recursive: true, mode: 0o700 })
        temporary = fs.mkdtempSync(path.join(root, 'GarageFlow-configuration', 'api-'))
        fs.chmodSync(temporary, 0o700)
        const file = path.join(temporary, 'body.json'); core.writePrivate(file, JSON.stringify(body))
        args.push('--input', file)
      } else args.push('--dangerously-skip-permissions') // plan was explicitly confirmed, including deletions
      const output = await api.tool('vercel', args)
      if (output.trim()) codec.decode(output)
    } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }) }
  }
  async function blobStores(project, target, snapshot) {
    if (!TARGETS.includes(target)) throw blobFailure('store_association')
    const validId = id => typeof id === 'string' && /^store_[A-Za-z0-9_-]+$/.test(id)
    // Hints originate from the authenticated, target-scoped project inventory.
    // They remain valid evidence even when the account cannot list all team stores.
    const ids = new Set(snapshot.records.filter(r => targets(r).includes(target) && !r.gitBranch && !r.customEnvironmentIds?.length &&
      validId(r.contentHint?.storeId) && (r.key === 'BLOB_READ_WRITE_TOKEN' || r.contentHint?.type === 'blob-read-write-token')).map(r => r.contentHint.storeId))
    const linked = links => Array.isArray(links) && links.some(p => p?.projectId === project.projectId &&
      [p.environments, p.envVarEnvironments].some(envs => Array.isArray(envs) && envs.includes(target)))
    let body
    try {
      body = await get(project, '/v1/storage/stores')
      if (!Array.isArray(body.stores) || body.pagination?.next) throw blobFailure('stores_inventory')
    } catch { if (ids.size) return [...ids]; throw blobFailure('stores_inventory') }
    let incomplete = false
    for (const listed of body.stores) {
      // The official CLI also accepts legacy Blob stores without a type field.
      if (!validId(listed?.id) || (listed.type && listed.type !== 'blob')) continue
      if (ids.has(listed.id)) continue
      if (linked(listed.projectsMetadata)) { ids.add(listed.id); continue }
      // Lists can contain [] or project-only summaries, not complete scopes.
      // Read the detail AND, if necessary, connections before declaring unbound.
      let store
      try {
        const detail = await get(project, `/v1/storage/stores/${encodeURIComponent(listed.id)}`)
        store = detail.store
        if (!store || store.id !== listed.id) throw blobFailure('stores_inventory')
        if (store.type && store.type !== 'blob') continue
        if (linked(store.projectsMetadata)) { ids.add(listed.id); continue }
      } catch { incomplete = true }
      try {
        const detail = await get(project, `/v1/storage/stores/${encodeURIComponent(listed.id)}/connections`)
        if (!Array.isArray(detail.connections)) throw blobFailure('stores_inventory')
        if (linked(detail.connections)) ids.add(listed.id)
      } catch { incomplete = true }
    }
    if (!ids.size && incomplete) throw blobFailure('stores_inventory')
    return [...ids]
  }
  async function recover(target, env) {
    if ((!env.DATABASE_URL || !env.DIRECT_URL) && await api.yes(`${target} : récupérer Neon via une session fournisseur et choisir explicitement la branche`)) {
      try { await api.configureNeon(env, { auto: false, allowCreate: false }) } catch { console.log('Neon : récupération non obtenue ; saisie locale requise, erreur fournisseur masquée.') }
    }
    if ((!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) && await api.yes(`${target} : rechercher une base Upstash existante (sans création)`)) {
      try {
        const databases = JSON.parse(await api.tool('upstash', ['redis', 'list']))
        if (!Array.isArray(databases) || !databases.length) throw failure()
        const selected = await api.select(`Upstash ${target} : sélectionner explicitement la base`, databases.map(d => ({ id: d.database_id, name: d.database_name })))
        const db = JSON.parse(await api.tool('upstash', ['redis', 'get', '--db-id', selected.id]))
        if (!db.rest_token || !/^[a-zA-Z0-9.-]+\.upstash\.io$/.test(db.endpoint)) throw failure()
        env.UPSTASH_REDIS_REST_URL = `https://${db.endpoint}`; env.UPSTASH_REDIS_REST_TOKEN = db.rest_token
      } catch { console.log('Upstash : accès non récupéré ; aucune ressource créée.') }
    }
  }
  async function ensureClients(env) {
    try {
      if (!fs.existsSync(path.join(root, 'node_modules/prisma/build/index.js')) || !fs.existsSync(path.join(root, 'node_modules/@vercel/blob/package.json'))) await api.execute([api.npmCli(), 'ci', '--ignore-scripts', '--include=dev'], { label: 'Dépendances config' })
      if (!fs.existsSync(path.join(root, 'src/generated/server-client/index.js'))) await api.execute([path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--schema', 'prisma/server/schema.prisma'], { env: { ...process.env, VERCEL: '1', ELECTRON: '', DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL }, label: 'Client Prisma PostgreSQL' })
    } catch {
      const error = failure('Dépendances/client Prisma non préparés : vérifier npm, le réseau de téléchargement des moteurs et les permissions locales. Saisies conservées, aucune mutation Vercel.')
      error.configPhase = 'dependencies'; throw error
    }
  }
  async function probeDatabase(env) {
    if (process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG) throw failure('Prisma : DEBUG actif refusé pour éviter des traces contenant des credentials.')
    const { PrismaClient } = api.loadServerClient ? api.loadServerClient() : require(path.join(root, 'src/generated/server-client'))
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const client = new PrismaClient({ datasourceUrl: env[key], log: [] })
      try { await client.$queryRawUnsafe('SELECT 1 AS config_probe') }
      catch { throw failure('Neon : connexion poolée ou directe non confirmée.') }
      finally { await client.$disconnect().catch(() => {}) }
    }
    const result = await (api.services || require('../config-services.cjs')).inspectDatabase(root, env.DIRECT_URL)
    return { pooled: true, direct: true, empty: result.empty }
  }
  async function probeRedis(env) {
    // Avoid arbitrary HTTPS endpoints receiving a Redis token.
    const u = new URL(env.UPSTASH_REDIS_REST_URL)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port || !u.hostname.endsWith('.upstash.io')) throw failure('Redis : endpoint Upstash requis.')
    await require('../config-services.cjs').testRedis(env, api.fetch || fetch)
    return true
  }
  async function probeBlob(env, ids) {
    if (process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG) throw failure('Blob : DEBUG actif refusé pour protéger les sorties du SDK.')
    // Supported read-write token format used by @vercel/blob 2.8.2.
    const token = core.normalizeInput('BLOB_READ_WRITE_TOKEN', env.BLOB_READ_WRITE_TOKEN)
    const entries = JSON.parse(fs.readFileSync(path.join(root, 'scripts/compromised-secrets.json'), 'utf8')).entries
    if (require('./config-credentials.cjs').compromised(token, entries)) throw blobFailure('token_exposed')
    const match = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9_-]+$/.exec(token || '')
    if (!match) throw blobFailure('token_format')
    if (!Array.isArray(ids) || !ids.length) throw blobFailure('store_association')
    if (!ids.some(id => id.replace(/^store_/, '').toLowerCase() === match[1].toLowerCase())) throw blobFailure('token_store_mismatch')
    if (process.env.VERCEL_BLOB_API_URL || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL) throw blobFailure('api_override')
    let sdk
    try {
      sdk = api.blobClient || require('@vercel/blob')
      const result = await sdk.list({ token, limit: 1, abortSignal: AbortSignal.timeout(15000) })
      if (!Array.isArray(result.blobs)) throw failure()
      return { associated: true, list: true, write: 'not_tested', applicationConsumer: false }
    } catch (error) {
      // Blob 2.8.2 subclasses retain Error.name === 'Error'. Prefer the
      // exported SDK classes rather than parsing messages or constructor names.
      const kind = Object.keys(BLOB_SDK_ERRORS).find(name => typeof sdk?.[name] === 'function' && error instanceof sdk[name])
      const code = kind ? BLOB_SDK_ERRORS[kind] : typeof error?.name === 'string' && Object.hasOwn(BLOB_SDK_ERRORS, error.name) ? BLOB_SDK_ERRORS[error.name] : null
      throw blobFailure(code || 'request_failed')
    }
  }
  async function probeBlobWrite(env, ids, { authorized = false, access } = {}) {
    if (!authorized || !['public', 'private'].includes(access)) throw failure('Blob : sonde mutante non autorisée.')
    // Recheck binding and prevent SDK API-override token exfiltration first.
    await probeBlob(env, ids)
    const sdk = api.blobClient || require('@vercel/blob'), token = core.normalizeInput('BLOB_READ_WRITE_TOKEN', env.BLOB_READ_WRITE_TOKEN)
    const storeId = token.split('_')[3].toLowerCase(), pathname = `garageflows-config-probe/${crypto.randomUUID()}.txt`
    let object, verified = false, cleaned = false
    const owns = blob => {
      try { const u = new URL(blob.url); return blob.pathname === pathname && u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === `/${pathname}` && u.hostname.startsWith(`${storeId}.`) && u.hostname.endsWith('.blob.vercel-storage.com') } catch { return false }
    }
    try {
      object = await sdk.put(pathname, 'GarageFlows configuration probe', { token, access, addRandomSuffix: false, allowOverwrite: false, abortSignal: AbortSignal.timeout(15000) })
      if (!owns(object)) throw failure()
      const info = await sdk.head(object.url, { token, abortSignal: AbortSignal.timeout(15000) })
      verified = info.pathname === pathname && info.size === Buffer.byteLength('GarageFlows configuration probe')
    } catch { /* cleanup also handles a successful PUT with a lost response */ }
    finally {
      try {
        if (!object || !owns(object)) {
          const listed = await sdk.list({ token, prefix: pathname, limit: 2, abortSignal: AbortSignal.timeout(15000) })
          object = listed.blobs.find(owns)
        }
        if (object && owns(object)) await sdk.del(object.url, { token, abortSignal: AbortSignal.timeout(15000) })
        const after = await sdk.list({ token, prefix: pathname, limit: 2, abortSignal: AbortSignal.timeout(15000) })
        cleaned = !after.hasMore && !after.blobs.some(blob => blob.pathname === pathname)
      } catch { /* never claim deletion if its readback failed */ }
    }
    if (!verified || !cleaned) {
      const error = failure('Blob : sonde écriture/lecture/suppression non confirmée ; aucune configuration distante appliquée.')
      error.probe = { pathname, cleanupVerified: cleaned }
      throw error
    }
    return { write: true, read: true, delete: true }
  }
  return { connect, read, write, blobStores, recover, ensureClients, probeDatabase, probeRedis, probeBlob, probeBlobWrite, normalize: normalizeStorage }
}
module.exports = { BLOB_DIAGNOSTICS, BLOB_TOKEN_ERRORS, TARGETS, validName, targets, stamp, recordsFor, protectedRecord, resourceAliases, cloud }

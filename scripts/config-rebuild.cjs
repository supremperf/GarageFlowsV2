'use strict'
// Reconstruction de la configuration production : aucun credential embarqué.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./config-core.cjs')
const vercelEnv = require('./lib/config-vercel-env.cjs')

const STORAGE_ALIASES = {
  DATABASE_URL: ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'],
  DIRECT_URL: ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_UNPOOLED'],
  UPSTASH_REDIS_REST_URL: ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'],
  UPSTASH_REDIS_REST_TOKEN: ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'],
}
const REQUIRED = Object.keys(STORAGE_ALIASES)
function clean(value) {
  return String(value || '').replace(/\[([^\]\r\n]+)\]\([^\r\n)]*\)/g, '$1').replace(/&amp;/g, '&').trim()
}
function normalizeStorage(source) {
  source = Object.fromEntries(Object.entries(source).map(([name, value]) => [name, core.normalizeInput(name, value)]))
  const result = Object.fromEntries(Object.entries(source).filter(([, value]) => vercelEnv.readable(value)))
  for (const [canonical, aliases] of Object.entries(STORAGE_ALIASES)) {
    const candidates = aliases.map(n => clean(source[n])).filter(vercelEnv.readable)
    if (candidates.length) result[canonical] = candidates[0]
  }
  // Build a connection only from actual provider parameters, never a guessed
  // hostname/password. The unpooled host must be supplied independently.
  const user = clean(source.PGUSER || source.POSTGRES_USER)
  const password = String(source.PGPASSWORD || source.POSTGRES_PASSWORD || '')
  const database = clean(source.PGDATABASE || source.POSTGRES_DATABASE)
  const port = clean(source.PGPORT)
  for (const [name, host] of [['DATABASE_URL', clean(source.PGHOST || source.POSTGRES_HOST)], ['DIRECT_URL', clean(source.PGHOST_UNPOOLED)]]) {
    if (result[name] || !vercelEnv.readable(user) || !vercelEnv.readable(password) || !vercelEnv.readable(database) || !/^[a-zA-Z0-9.-]+$/.test(host) || (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))) continue
    const url = new URL(`postgresql://${host}${port ? `:${port}` : ''}`)
    url.username = user; url.password = password
    url.pathname = `/${encodeURIComponent(database)}`
    url.searchParams.set('sslmode', 'require')
    result[name] = url.toString()
  }
  return result
}
function identity(root) {
  let project
  try { project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8')) } catch { /* sanitized below */ }
  if (!project?.projectId || !project.orgId) throw new Error('Reconstruction : projet Vercel non lié.')
  return { projectId: project.projectId, orgId: project.orgId }
}
function sameProject(a, b) { return a?.projectId === b?.projectId && a?.orgId === b?.orgId }
function records(remote) {
  if (!Array.isArray(remote.records)) throw new Error('Reconstruction : inventaire complet des variables Vercel requis.')
  if (remote.records.some(r => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key || '') || ['__proto__', 'constructor', 'prototype'].includes(r.key) || r.gitBranch)) throw new Error('Reconstruction : nom de variable ou cible de branche non pris en charge ; aucune suppression.')
  const keys = remote.records.map(r => r.key)
  if (keys.length !== new Set(keys).size) throw new Error('Reconstruction : variables production dupliquées/branches spécifiques, arrêt avant suppression.')
  return remote.records
}
function planRebuild(remote, env, names, platform = [], excluded = []) {
  const system = new Set(platform)
  const managed = records(remote).filter(r => r.configurationId || r.integrationId || r.type === 'system' || r.contentHint?.storeId || system.has(r.key))
  const protectedNames = new Set(managed.map(r => r.key))
  const remove = records(remote).filter(r => !protectedNames.has(r.key)).map(r => r.key)
  const discarded = new Set(excluded)
  const values = {}
  // Preserve non-generable third-party settings, even if not consumed by this app.
  for (const name of remove) {
    if (discarded.has(name)) continue
    if (remote.values[name]) values[name] = remote.values[name]
    else if (!names.includes(name) && !env[name]) throw new Error(`Reconstruction : ${name} est illisible et non générable. Récupération fournisseur requise ; aucune suppression effectuée.`)
  }
  for (const name of names) if (env[name]) values[name] = env[name]
  for (const name of protectedNames) {
    if (values[name] && (!remote.values[name] || values[name] !== remote.values[name])) {
      throw new Error(`Reconstruction : ${name} appartient à une intégration/plateforme et ne peut pas être remplacée par ce plan.`)
    }
    delete values[name]
  }
  for (const name of remove) {
    if (discarded.has(name)) continue
    if (!values[name] && env[name]) values[name] = env[name]
    if (!values[name]) throw new Error(`Reconstruction : ${name} sans valeur de restauration ; aucune suppression effectuée.`)
  }
  return { remove, values, protectedNames: [...protectedNames] }
}

// Read authenticated project values and discover only resources bound to the
// authorized project; no reconnect/reset as a substitute for recovering a value.
async function recoverStorage(base, remote, project) {
  return require('./config-storage-discovery.cjs').discover(base, remote, project,
    { normalize: normalizeStorage, required: REQUIRED, aliases: STORAGE_ALIASES })
}

// A targeted investigation must not run the rebuild, export .env files, or
// retry logins. Only the credential-free report is persisted.
async function diagnoseStorage(base) {
  const project = identity(base.root)
  const label = value => String(value).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160)
  console.log(`Diagnostic Storage : projet ${label(project.projectId)}, équipe ${label(project.orgId)}, production uniquement.`)
  if (!await base.yes('Confirmer cette cible pour une lecture seule, sans export de secrets ni modification distante')) throw new Error('Diagnostic Storage annulé ; aucune requête effectuée.')
  const remote = require('./lib/config-vercel-env.cjs').fromPull([], {})
  const result = await recoverStorage({ ...base, refreshVercelAuth: undefined }, remote, project)
  if (!sameProject(project, identity(base.root))) throw new Error('Cible Vercel modifiée pendant le diagnostic ; aucun rapport remplacé.')
  const reportPath = path.join('GarageFlow-configuration', 'storage-discovery.json')
  core.writePrivate(path.join(base.root, reportPath), JSON.stringify(result.discovery, null, 2) + '\n')
  console.log(`Diagnostic écrit : ${reportPath} (sans valeurs ni erreurs brutes). Aucun profil .env modifié, aucune reconstruction lancée.`)
  return result.discovery
}

function automaticApi(base, { platform = [], excluded = [] } = {}) {
  const root = base.root
  const folder = path.join(root, 'GarageFlow-configuration')
  const journalFile = path.join(folder, 'rebuild-pending.json')
  const sourcesFile = path.join(folder, 'rebuild-sources.json')
  let project, approvedProject, snapshot, backup, pending, savedSources = {}, serviceSource = {}
  const api = { ...base }
  api.question = async (label, options) => {
    if (label.includes('AUTORISER')) {
      if (fs.existsSync(path.join(root, '.vercel/project.json'))) approvedProject = identity(root)
      return base.question(label, options)
    }
    // No credential or arbitrary business choice is invented to satisfy a prompt.
    return ''
  }
  const allowed = [
    'Migrer cette configuration', 'Autoriser leur retrait', 'Retirer ces paramètres',
    'Clé API du keygen différente', 'Aligner aussi les défauts PUBLICS',
    'Créer la première licence ADMIN',
  ]
  api.yes = async label => allowed.some(prefix => label.startsWith(prefix))
  api.select = async (_label, list) => {
    if (list.length === 1) return list[0]
    throw new Error('Reconstruction : plusieurs ressources possibles ; rattachez la bonne ressource au projet Vercel. Aucun choix arbitraire.')
  }
  api.secretField = async (env, name) => {
    if (env[name] || name === 'ANTHROPIC_API_KEY') return
    throw new Error(`${name} : accès non récupérable automatiquement. Connectez le service à Vercel production ou restaurez son accès local privé ; aucune saisie de secret demandée.`)
  }
  api.setupVercel = async () => {
    let remote = await base.setupVercel({ authorized: true })
    project = identity(root)
    if (approvedProject && !sameProject(approvedProject, project)) throw new Error('Le projet lié a changé depuis AUTORISER ; aucune reconstruction autorisée.')
    if (fs.existsSync(sourcesFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'))
        if (sameProject(project, saved.project)) savedSources = saved.values || {}
      } catch { throw new Error('Coffre des accès fournisseur illisible ; aucune suppression autorisée.') }
    }
    if (fs.existsSync(journalFile)) {
      try { pending = JSON.parse(fs.readFileSync(journalFile, 'utf8')) } catch { throw new Error('Journal de reconstruction illisible ; aucune suppression autorisée.') }
      if (!sameProject(project, pending.project) || !pending.env || !pending.originalValues || !pending.planValues) throw new Error('Journal lié à une autre cible ou incomplet ; aucune suppression autorisée.')
    }
    remote = await recoverStorage(base, remote, project)
    snapshot = remote
    records(snapshot)
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    backup = fs.mkdtempSync(path.join(folder, 'rebuild-'))
    fs.chmodSync(backup, 0o700)
    if (remote.discovery) core.writePrivate(path.join(folder, 'storage-discovery.json'), JSON.stringify(remote.discovery, null, 2) + '\n')
    for (const name of ['.env', '.env.server.local', '.env.storage.local', 'keys/server_config.json']) {
      const file = path.join(root, name)
      if (fs.existsSync(file)) core.writePrivate(path.join(backup, name), fs.readFileSync(file, 'utf8'))
    }
    core.writePrivate(path.join(backup, 'vercel-original.env'), core.serializeEnv(remote.values, Object.keys(remote.values), 'rebuild-backup'))
    console.log('Sauvegarde privée des profils et des valeurs récupérées effectuée. Aucune valeur secrète affichée.')
    return remote
  }
  api.importRemote = async (local, remote, names) => {
    // Vercel's readable credentials win over an outdated local service password.
    const privateStorage = core.readEnv(path.join(root, '.env.storage.local'))
    const source = { ...normalizeStorage(savedSources), ...normalizeStorage(privateStorage), ...normalizeStorage(local), ...normalizeStorage(remote.values) }
    if (pending) Object.assign(source, pending.env)
    const missing = REQUIRED.filter(n => !source[n])
    if (missing.length) throw new Error(`Accès Storage introuvables : ${missing.join(', ')}. Consultez le diagnostic de découverte (storage-discovery.json, sans valeurs). Le rapport distingue challenge d’authentification, refus HTTP, valeurs masquées/non déchiffrées et réponses inattendues. Une ressource liée ne garantit pas que ses secrets sont exportables ; une reconnexion ne résout pas nécessairement ce blocage. Aucune variable distante supprimée.`)
    const connectionIssues = core.validate(source, 'pwa', { vercel: true })
      .filter(m => REQUIRED.some(n => m.startsWith(`${n} :`)))
    if (connectionIssues.length) throw new Error('Connexions Storage invalides ; aucune suppression. Vérifiez les connexions PostgreSQL poolée/directe et Redis REST du projet.')
    const tools = base.services || require('./config-services.cjs')
    const database = await tools.inspectDatabase(root, source.DIRECT_URL)
    if (!database.empty) throw new Error('Reconstruction refusée : base contenant des données métier. Utilisez node config --conserver-secrets pour préserver les données, jetons et clés existants. Aucune suppression ni rotation effectuée.')
    const env = Object.fromEntries(names.filter(n => source[n]).map(n => [n, source[n]]))
    for (const name of names) {
      if (!core.GENERATED[name] && name !== 'GF_EINVOICE_CREDENTIALS_KEY') continue
      env[name] = pending?.env[name] || crypto.randomBytes(32).toString(core.GENERATED[name] || 'base64')
    }
    // Signing authorities and historical *_OLD keys are never random replacements.
    if (!env.GF_PRIVATE_KEY && fs.existsSync(path.join(root, 'keys/private.pem'))) {
      const pem = fs.readFileSync(path.join(root, 'keys/private.pem'), 'utf8')
      if (!/ENCRYPTED/.test(pem)) env.GF_PRIVATE_KEY = Buffer.from(pem).toString('base64')
    }
    const storage = Object.fromEntries(Object.keys(source).filter(n => /^(?:DATABASE_URL|DIRECT_URL|PG|POSTGRES_|KV_|REDIS_URL|UPSTASH_|BLOB_)/.test(n)).map(n => [n, source[n]]))
    core.writePrivate(path.join(root, '.env.storage.local'), core.serializeEnv(storage, Object.keys(storage), 'storage-private'))
    // Dry-run completeness before local keygen changes, SQL migrations or deletion.
    serviceSource = { ...source, ...env }
    planRebuild(remote, serviceSource, names, platform, excluded)
    remote.deferredGenerated = new Set()
    remote.generatedHere = new Set(names.filter(n => core.GENERATED[n] || n === 'GF_EINVOICE_CREDENTIALS_KEY'))
    return env
  }
  const tools = base.services || require('./config-services.cjs')
  api.services = { ...tools,
    configureUpstash: async env => {
      if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error('Accès Redis non récupéré du Storage ; aucun identifiant inventé.')
      return 'reused'
    },
    configureServerEndpoint: async env => {
      if (!env.NEXTAUTH_URL) {
        let info
        try { info = JSON.parse(await base.tool('vercel', ['api', `/v9/projects/${encodeURIComponent(project.projectId)}?teamId=${encodeURIComponent(project.orgId)}`])) } catch { throw new Error('Domaine public du projet Vercel inaccessible.') }
        const aliases = info.targets?.production?.alias || []
        const candidates = aliases.filter(n => typeof n === 'string' && /^[a-zA-Z0-9.-]+$/.test(n))
        const custom = candidates.filter(n => !n.endsWith('.vercel.app'))
        const selected = (custom.length ? custom : candidates).sort()[0]
        if (!selected) throw new Error('Projet sans domaine production : rattachez le domaine dans Vercel, aucune URL fictive créée.')
        env.NEXTAUTH_URL = `https://${selected}`
      }
      const url = new URL(env.NEXTAUTH_URL)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('URL publique du projet invalide.')
      env.GF_APP_URL ||= env.NEXTAUTH_URL
    },
  }
  api.licenseKey = async (env, options) => {
    const file = path.join(root, 'keys/private.pem')
    if (fs.existsSync(file) && /ENCRYPTED/.test(fs.readFileSync(file, 'utf8'))) throw new Error('Clé privée locale chiffrée : déverrouillage du coffre requis hors reconstruction automatique.')
    return base.licenseKey(env, options)
  }
  api.licensePassphrase = async () => { throw new Error('Clé privée chiffrée : déverrouillage préalable du coffre requis.') }
  api.configureNeon = async () => { throw new Error('Connexion Neon absente du Storage lié ; aucune création ni sélection de base arbitraire.') }
  api.syncVercel = async (env, names) => {
    if (!sameProject(project, identity(root))) throw new Error('Projet Vercel modifié ; aucune suppression autorisée.')
    if (!(await api.services.inspectDatabase(root, env.DIRECT_URL)).empty) throw new Error('Des données métier sont apparues pendant le plan ; aucune suppression autorisée.')
    let current = await base.pullVercel()
    const oldKeys = [...snapshot.present].sort(), newKeys = [...current.present].sort()
    if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys) || oldKeys.some(n => snapshot.stamps[n] !== current.stamps[n])) {
      throw new Error('Vercel a changé pendant le plan ; aucune suppression. Relancez config.')
    }
    // A dedicated decryption read may have recovered a provider value that the
    // regular pull still masks. Reuse it only for the exact unchanged version.
    current = vercelEnv.attach(current, Object.fromEntries([...current.hidden].filter(n =>
      snapshot.stamps[n] === current.stamps[n] && vercelEnv.readable(snapshot.values[n])).map(n => [n, snapshot.values[n]])))
    if (pending) current.values = { ...pending.originalValues, ...current.values }
    const plan = planRebuild(current, { ...serviceSource, ...env }, names, platform, excluded)
    if (pending) {
      plan.values = { ...pending.planValues, ...plan.values }
      for (const name of [...plan.protectedNames, ...excluded]) delete plan.values[name]
    }
    const state = { schema: 1, project, env, planValues: plan.values, originalValues: current.values, phase: 'prepared', backup }
    core.writePrivate(journalFile, JSON.stringify(state, null, 2) + '\n')
    core.writePrivate(path.join(backup, 'vercel-new.env'), core.serializeEnv(plan.values, Object.keys(plan.values), 'rebuild-production'))
    console.log(`Reconstruction production : ${plan.remove.length} variables supprimées puis réécrites ; ${plan.protectedNames.length} variables intégration/plateforme préservées. Preview/development inchangés.`)
    const providerValues = Object.fromEntries(Object.entries({ ...serviceSource, ...plan.values }).filter(([name]) => !core.GENERATED[name] && name !== 'GF_EINVOICE_CREDENTIALS_KEY' && name !== 'GF_PRIVATE_KEY'))
    core.writePrivate(sourcesFile, JSON.stringify({ schema: 1, project, values: providerValues }, null, 2) + '\n')
    state.phase = 'applying'
    core.writePrivate(journalFile, JSON.stringify(state, null, 2) + '\n')
    for (const name of plan.remove) await base.tool('vercel', ['env', 'rm', name, 'production', '--yes'])
    for (const [name, value] of Object.entries(plan.values)) {
      await base.tool('vercel', ['env', 'add', name, 'production', (core.isSecret(name) || /^(?:PGPASSWORD|POSTGRES_|KV_|REDIS_URL|BLOB_)/.test(name)) ? '--sensitive' : '--no-sensitive', '--yes'], { input: value })
    }
    const actual = await base.pullVercel()
    for (const [name, value] of Object.entries(plan.values)) {
      if (!actual.present.has(name) || (!actual.hidden.has(name) && actual.values[name] !== value) || (snapshot.present.has(name) && actual.stamps[name] === snapshot.stamps[name])) {
        throw new Error(`Vérification après reconstruction échouée : ${name}. Journal privé conservé pour reprise.`)
      }
    }
    for (const name of excluded.filter(n => plan.remove.includes(n))) if (actual.present.has(name)) throw new Error(`Variable hors profil encore présente : ${name}. Journal conservé.`)
    for (const name of plan.protectedNames) if (actual.stamps[name] !== current.stamps[name]) throw new Error(`Variable protégée modifiée : ${name}. Journal conservé.`)
    const receipts = require('./lib/config-secrets-auto.cjs')
    receipts.ecrireRecus(root, { projet: `${project.orgId}/${project.projectId}`, valeurs: plan.values, stamps: actual.stamps })
    fs.unlinkSync(journalFile)
    console.log('Reconstruction vérifiée. Valeurs secrètes masquées ; profils locaux et journal de reprise privés.')
    return true
  }
  return api
}
module.exports = { STORAGE_ALIASES, normalizeStorage, identity, planRebuild, recoverStorage, diagnoseStorage, automaticApi }

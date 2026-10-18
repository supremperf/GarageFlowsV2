'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { spawn } = require('node:child_process')
const core = require('./config-core.cjs')

function run(program, args, { cwd, env = process.env, input, label = 'Outil' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { if (output.length < 2_000_000) output += chunk })
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    child.once('error', () => reject(new Error(`${label} : lancement impossible.`)))
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`${label} : échec (sortie brute masquée).`)))
  })
}
const DEFAULT_SERVER_URL = 'https://garageflows.fr'
async function configureServerEndpoint(env, api) {
  if (env.NEXTAUTH_URL) {
    let same = false
    try {
      const current = new URL(env.NEXTAUTH_URL)
      same = current.origin === DEFAULT_SERVER_URL && current.pathname === '/' && !current.search && !current.hash && !current.username && !current.password
    } catch { /* Invalid or different existing endpoint must not be changed silently. */ }
    if (!same) {
      if (!await api.yes(`URL serveur existante différente : autoriser la cible ${DEFAULT_SERVER_URL} pour le serveur et le keygen (aucune rotation de clé API)`)) throw new Error('Cible serveur différente conservée, configuration interrompue. La cible attendue est https://garageflows.fr.')
      env.NEXTAUTH_URL = DEFAULT_SERVER_URL
    }
  } else env.NEXTAUTH_URL = DEFAULT_SERVER_URL
  env.GF_APP_URL ||= DEFAULT_SERVER_URL
  console.log(`Serveur/keygen : ${DEFAULT_SERVER_URL}. La clé API serveur sera reprise automatiquement dans keys/server_config.json ; aucune clé affichée.`)
}
// Les registres de migrations ne sont PAS des données métier : une base neuve
// issue du modèle SQLite livré contient déjà _gf_migrations (baseline complète)
// et une base PostgreSQL migrée contient _prisma_migrations. Les compter comme
// « données » ferait croire à une base utilisée et bloquerait la première
// installation en réclamant des clés qui n'ont jamais existé.
const BOOKKEEPING_TABLE = /^_(?:prisma|gf)_migrations$/i
function isBookkeepingTable(name) {
  return BOOKKEEPING_TABLE.test(String(name).trim())
}
function businessTableNames(names) {
  return [...new Set(names.map(n => String(n)).filter(n => !isBookkeepingTable(n) && !/^sqlite_/i.test(n)))]
}
async function inspectDatabase(root, url) {
  let client
  try {
    const { PrismaClient } = require(path.join(root, 'src/generated/server-client'))
    client = new PrismaClient({ datasourceUrl: url, log: [] })
    const schema = new URL(url).searchParams.get('schema') || 'public'
    const rows = await client.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'", schema)
    const tables = businessTableNames(rows.map(r => r.table_name))
    // Identifiers are quoted, never interpolated unescaped. Only row existence is read.
    const sql = tables.map(n => `SELECT EXISTS(SELECT 1 FROM "${schema.replace(/"/g, '""')}"."${n.replace(/"/g, '""')}" LIMIT 1) AS occupied`).join(' UNION ALL ')
    const occupied = tables.length ? await client.$queryRawUnsafe(sql) : []
    return { empty: !occupied.some(r => r.occupied), tableCount: tables.length, ignored: rows.length - tables.length }
  } catch { throw new Error('PostgreSQL : connexion/inspection impossible. Aucun secret généré en remplacement et aucune migration lancée.') }
  finally { if (client) await client.$disconnect().catch(() => {}) }
}
async function inspectDesktop(root, url, { loadClient } = {}) {
  if (!url?.startsWith('file:')) throw new Error('Desktop : URL SQLite requise avant inspection.')
  const file = path.resolve(root, 'prisma', url.slice(5).split('?')[0])
  if (!fs.existsSync(file)) return { empty: true, tableCount: 0, ignored: 0 }
  let client
  try {
    // loadClient n'existe que pour les tests : la production ouvre le client Prisma local.
    if (loadClient) client = loadClient(file)
    else {
      const { PrismaClient } = require(path.join(root, 'node_modules/@prisma/client'))
      client = new PrismaClient({ datasourceUrl: `file:${file.replace(/\\/g, '/')}`, log: [] })
    }
    const rows = await client.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'")
    const all = rows.map(r => r.name)
    const tables = businessTableNames(all)
    const sql = tables.map(n => `SELECT EXISTS(SELECT 1 FROM "${n.replace(/"/g, '""')}" LIMIT 1) AS occupied`).join(' UNION ALL ')
    const occupied = tables.length ? await client.$queryRawUnsafe(sql) : []
    return { empty: !occupied.some(r => r.occupied), tableCount: tables.length, ignored: all.length - tables.length }
  } catch { throw new Error('SQLite : inspection impossible. Aucun secret absent généré à l’aveugle pour une base existante.') }
  finally { if (client) await client.$disconnect().catch(() => {}) }
}
function ensureDesktopDatabase(root, url) {
  if (!url?.startsWith('file:')) throw new Error('Desktop : URL SQLite requise.')
  const file = path.resolve(root, 'prisma', url.slice(5).split('?')[0])
  let ancestor = file
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const actual = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, file))
  if (actual.split(path.sep).includes('.git')) throw new Error('Desktop : dossier Git interdit comme destination de base.')
  if (fs.existsSync(file)) return 'existing-preserved'
  if (!/\.(db|sqlite|sqlite3)$/i.test(file)) throw new Error('Desktop : base absente sans extension .db/.sqlite/.sqlite3 ; confirmer/créer ce chemin manuellement avant configuration.')
  const template = path.join(root, 'prisma/garageflow-template.db')
  if (!fs.existsSync(template)) throw new Error('Desktop : template SQLite absent, aucune base vide fictive créée.')
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.copyFileSync(template, file, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(file, 0o600)
  return 'created-from-template'
}
async function configureUpstash(env, api) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return 'reused'
  console.log('Redis : tentative de récupération avec le CLI officiel Upstash (sorties contenant des credentials masquées).')
  try {
    let raw
    try { raw = await api.tool('upstash', ['redis', 'list']) }
    catch {
      console.log('Accès nécessaire : le CLI demande email + clé Developer API disponible dans https://console.upstash.com/account/api (pas votre mot de passe).')
      await api.tool('upstash', ['login'], { interactive: true })
      raw = await api.tool('upstash', ['redis', 'list'])
    }
    let databases = JSON.parse(raw)
    if (!Array.isArray(databases)) throw new Error()
    let database
    if (databases.length) {
      database = databases.length === 1 ? databases[0] : await api.select('Base Redis cible', databases.map(d => ({ ...d, name: d.database_name })))
      database = JSON.parse(await api.tool('upstash', ['redis', 'get', '--db-id', database.database_id]))
    } else {
      console.log('Aucune base Upstash. La création peut engager le compte fournisseur ; aucun passage automatique à un forfait payant.')
      if (!await api.yes('Autoriser la création d’une base Redis gratuite en Europe')) throw new Error()
      let auth
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/upstash/config.json'), 'utf8'))
        if (saved.email && (saved.api_key || saved.apiKey)) auth = { email: saved.email, apiKey: saved.api_key || saved.apiKey }
      } catch { /* Custom CLI credential locations cannot be guessed. Ask locally. */ }
      if (!auth) auth = {
        email: await api.question('Email Developer API Upstash (session non disponible au chemin standard)', { secret: true }),
        apiKey: await api.question('Clé Developer API Upstash (saisie masquée, en mémoire uniquement)', { secret: true }),
      }
      database = await createFreeRedis(auth)

    }
    if (!database.rest_token || !database.endpoint) throw new Error()
    const endpoint = String(database.endpoint)
    if (!/^[a-zA-Z0-9.-]+$/.test(endpoint)) throw new Error()
    env.UPSTASH_REDIS_REST_URL = `https://${endpoint.includes('.') ? endpoint : `${endpoint}.upstash.io`}`
    env.UPSTASH_REDIS_REST_TOKEN = database.rest_token
    return 'imported'
  } catch {
    console.log('Récupération automatique Redis indisponible : autorisation/API/format non exploitable. Aucun service fictif ne sera configuré.')
    env.UPSTASH_REDIS_REST_URL = await api.question('URL REST HTTPS Upstash', { defaultValue: env.UPSTASH_REDIS_REST_URL || '' })
    await api.secretField(env, 'UPSTASH_REDIS_REST_TOKEN')
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error('Redis : accès indispensable manquant.')
    return 'manual'
  }
}
async function createFreeRedis(auth, fetcher = fetch) {
  if (!auth.email || !auth.apiKey) throw new Error('Upstash : autorisation Developer API manquante.')
  try {
    const response = await fetcher('https://api.upstash.com/v2/redis/database', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiKey}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ database_name: 'garageflows', platform: 'aws', primary_region: 'eu-west-1', plan: 'free', tls: true, eviction: false }),
    })
    if (!response.ok) throw new Error()
    const database = await response.json()
    if (!database.database_id || (database.type && database.type !== 'free')) throw new Error()
    return database
  } catch { throw new Error('Upstash : création gratuite non confirmée. Aucun passage automatique payant ni nouvelle tentative aveugle ; vérifier la console pour une éventuelle création partielle.') }
}
async function testRedis(env, fetcher = fetch) {
  const u = new URL(env.UPSTASH_REDIS_REST_URL)
  // Credentials cannot follow redirects to another server.
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Redis : URL HTTPS sans identifiants intégrés requise.')
  try {
    const response = await fetcher(u, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: '["PING"]' })
    if (!response.ok || (await response.json()).result !== 'PONG') throw new Error()
  } catch { throw new Error('Redis : PING REST échoué. Token/URL/réseau à corriger ; aucun repli mémoire activé.') }
}
function publicFingerprint(pem) {
  return crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}
function configureKeygen(root, env, { privatePassphrase, authorizeApiReplacement = false } = {}) {
  const pem = Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString('utf8')
  if (!core.licenseKeyMatches(env.GF_PRIVATE_KEY, core.embeddedLicenseKey(root))) throw new Error('Keygen : clé privée différente des ancrages publics.')
  const pub = crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString()
  const privateFile = path.join(root, 'keys/private.pem')
  const hasPrivateFile = fs.existsSync(privateFile)
  let preserveEncrypted = false
  if (hasPrivateFile) {
    const existing = fs.readFileSync(privateFile, 'utf8')
    preserveEncrypted = /ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(existing)
    let key
    try { key = crypto.createPrivateKey(preserveEncrypted ? { key: existing, passphrase: privatePassphrase } : existing) }
    catch { throw new Error('Keygen : passphrase de la clé locale chiffrée requise ou clé illisible.') }
    if (publicFingerprint(key) !== publicFingerprint(pub)) throw new Error('Keygen : autre clé locale existante, aucune rotation autorisée.')
  }
  const publicFile = path.join(root, 'keys/public.pem')
  if (fs.existsSync(publicFile) && publicFingerprint(fs.readFileSync(publicFile)) !== publicFingerprint(pub)) throw new Error('Keygen : clé publique locale divergente.')
  // Preserve original bytes/encoding too (SEC1/PKCS#8/encrypted), not just the key identity.
  if (!hasPrivateFile) core.writePrivate(privateFile, pem, { exclusive: true })
  core.writePrivate(publicFile, pub)
  const file = path.join(root, 'keys/server_config.json')
  let old = {}
  if (fs.existsSync(file)) {
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new Error('Keygen : server_config.json invalide, fichier conservé.') }
    if (old.api_key && old.api_key !== env.GARAGEFLOW_API_KEY && !authorizeApiReplacement) throw new Error('Keygen : clé API locale différente, vérifier la cible avant synchronisation.')
  }
  core.writePrivate(file, JSON.stringify({ ...old, url: env.NEXTAUTH_URL.replace(/\/+$/, ''),
    api_key: env.GARAGEFLOW_API_KEY, max_mechanic: Number(env.GF_MAX_MECHANIC_KEYS || 20) }, null, 2) + '\n')
}
function patchClientDefaults(root, publicUrl, { updateUrl = publicUrl, appUrl = publicUrl } = {}) {
  const u = new URL(publicUrl)
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || !/^[a-zA-Z0-9.-]+$/.test(u.hostname)) throw new Error('Client : URL publique racine HTTPS requise.')
  const updateBase = new URL(updateUrl), appBase = new URL(appUrl)
  for (const candidate of [updateBase, appBase]) {
    if (candidate.protocol !== 'https:' || candidate.username || candidate.password || candidate.pathname !== '/' || candidate.search || candidate.hash || !/^[a-zA-Z0-9.-]+$/.test(candidate.hostname)) throw new Error('Client : endpoint public racine HTTPS requis.')
  }
  const base = u.origin
  const targets = [
    ['electron/license-endpoint.js', /const OFFICIAL_LICENSE_SERVER = '[^']*'/, `const OFFICIAL_LICENSE_SERVER = '${base}'`],
    ['src/lib/public-url.ts', /export const OFFICIAL_PUBLIC_APP_URL = '[^']*'/, `export const OFFICIAL_PUBLIC_APP_URL = '${appBase.origin}'`],
  ]
  const changes = []
  for (const [file, pattern, replacement] of targets) {
    const full = path.join(root, file), text = fs.readFileSync(full, 'utf8')
    if (!pattern.test(text)) throw new Error('Client : ancrage public inattendu, aucune réécriture approximative.')
    const next = text.replace(pattern, replacement)
    if (next !== text) changes.push([full, next])
  }
  const main = path.join(root, 'electron/main.js')
  const text = fs.readFileSync(main, 'utf8')
  const fallback = /(const UPDATE_SERVER\s*=\s*\(process\.env\.GF_UPDATE_SERVER\s*\|\|\s*process\.env\.GF_LICENSE_SERVER\s*\|\|\s*)'[^']*'/
  if (!fallback.test(text)) throw new Error('Client : repli de mise à jour introuvable.')
  const next = text.replace(fallback, `$1'${updateBase.origin}'`)
  if (next !== text) changes.push([main, next])
  for (const [relative, variable] of [['electron/update-verify.js', 'ALLOWED_DOWNLOAD_HOSTS'], ['scripts/sign-release-manifest.mjs', 'HOTES_AUTORISES']]) {
    const file = path.join(root, relative), source = fs.readFileSync(file, 'utf8')
    const hosts = new RegExp(`(const ${variable} = new Set\\(\\[)([\\s\\S]*?)(\\]\\))`)
    const block = source.match(hosts)
    if (!block) throw new Error('Client/publication : liste de domaines de téléchargement introuvable.')
    if (![...block[2].matchAll(/'([^']*)'/g)].some(m => m[1] === updateBase.hostname)) {
      changes.push([file, source.replace(hosts, (_m, head, body, tail) => {
        const clean = body.trimEnd()
        return `${head}${clean}${clean.trim().endsWith(',') || !clean.trim() ? '' : ','}\n  '${updateBase.hostname}',\n${tail}`
      })])
    }
  }
  // Validate every target before making the first change.
  for (const [file, source] of changes) fs.writeFileSync(file, source)
  return changes.map(([file]) => path.relative(root, file))
}
function assertExternalFile(root, file) {
  const absolute = path.resolve(file)
  const rootReal = fs.realpathSync(root)
  let ancestor = absolute
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error('Coffre : chemin non exploitable.')
    ancestor = parent
  }
  const ancestorReal = fs.realpathSync(ancestor)
  const actual = path.resolve(ancestorReal, path.relative(ancestor, absolute))
  const rel = path.relative(rootReal, actual)
  if (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)) throw new Error('Coffre : une clé privée de publication doit rester HORS du dépôt (liens symboliques inclus).')
  return actual
}
function installPublisherKey(root, file, pem) {
  const external = assertExternalFile(root, file)
  const key = crypto.createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Publication : clé privée Ed25519 requise.')
  const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()
  if (fs.existsSync(external)) {
    const old = fs.readFileSync(external)
    if (publicFingerprint(old) !== publicFingerprint(pub)) throw new Error('Publication : coffre existant différent, refus de remplacement.')
  } else core.writePrivate(external, pem, { exclusive: true })
  const sourceFile = path.join(root, 'electron/update-verify.js')
  delete require.cache[require.resolve(sourceFile)]
  const known = require(sourceFile).PUBLIC_KEYS
  let keyId = Object.keys(known).find(id => publicFingerprint(known[id]) === publicFingerprint(pub))
  if (!keyId) {
    keyId = `gf-update-${publicFingerprint(pub).slice(0, 12)}`
    const text = fs.readFileSync(sourceFile, 'utf8')
    const pattern = /(const PUBLIC_KEYS = \{)([\s\S]*?)(\n\})/
    if (!pattern.test(text)) throw new Error('Publication : ancrage PUBLIC_KEYS inattendu.')
    // Keep ALL historical keys. Only a public key is added to source.
    fs.writeFileSync(sourceFile, text.replace(pattern, (_match, head, body, tail) =>
      `${head}${body}\n  '${keyId}': ${JSON.stringify(pub)},${tail}`))
  }
  core.writePrivate(path.join(root, 'GarageFlow-configuration/publisher.json'), JSON.stringify({ keyFile: external, keyId, publicKey: pub }, null, 2) + '\n')
  return { keyId, keyFile: external }
}
function buildAdminLicense(pem, macSecret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const lid = crypto.randomUUID()
  const payload = { lid, cid: 'CONFIG-BOOTSTRAP-ADMIN', typ: 'admin', iss: nowSeconds,
    exp: nowSeconds + 365 * 86400, seats: 1, ver: '2.0',
    wm: Buffer.from(JSON.stringify({ c: 'CONFIG-BOOTSTRAP-ADMIN', t: nowSeconds, r: crypto.randomBytes(6).toString('hex'), l: 'Initialisation config' })).toString('base64url') }
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), pem).toString('base64url')
  const expiryAt = new Date(payload.exp * 1000)
  const recordMac = crypto.createHmac('sha256', macSecret).update([lid, `GF2.${header}.${body}.${sig}`, 'active', expiryAt.toISOString(), ''].join('\x00')).digest('hex')
  return { licenseId: lid, token: `GF2.${header}.${body}.${sig}`, customerId: payload.cid,
    licenseType: 'admin', isAdmin: true, seats: 1, status: 'active', expiryAt, recordMac, label: 'Initialisation config' }
}
async function bootstrapAdmin(root, env) {
  let client
  const file = path.join(root, 'keys/bootstrap-admin-license.json')
  try {
    const { PrismaClient } = require(path.join(root, 'src/generated/server-client'))
    client = new PrismaClient({ datasourceUrl: env.DIRECT_URL, log: [] })
    if (await client.licenseKey.count() !== 0) return 'existing-licenses-not-modified'
    // Persist a resumable candidate BEFORE mutation, never print the license token.
    let record
    if (fs.existsSync(file)) {
      record = JSON.parse(fs.readFileSync(file, 'utf8'))
      record.expiryAt = new Date(record.expiryAt)
      const parts = String(record.token).split('.')
      const pem = crypto.createPublicKey(Buffer.from(env.GF_PRIVATE_KEY, 'base64'))
      if (parts.length !== 4 || !crypto.verify('sha256', Buffer.from(`${parts[1]}.${parts[2]}`), pem, Buffer.from(parts[3], 'base64url'))) throw new Error()
      const claims = JSON.parse(Buffer.from(parts[2], 'base64url'))
      if (claims.typ !== 'admin' || claims.lid !== record.licenseId || claims.cid !== record.customerId || claims.exp * 1000 !== record.expiryAt.getTime() || record.status !== 'active' || !record.isAdmin || record.licenseType !== 'admin' || record.hwid || record.parentLicenseId || record.mechanicId) throw new Error()
      record.recordMac = crypto.createHmac('sha256', env.GF_DB_MAC_SECRET).update([record.licenseId, record.token, 'active', record.expiryAt.toISOString(), ''].join('\x00')).digest('hex')
    } else {
      record = buildAdminLicense(Buffer.from(env.GF_PRIVATE_KEY, 'base64').toString('utf8'), env.GF_DB_MAC_SECRET)
      core.writePrivate(file, JSON.stringify(record, null, 2) + '\n')
    }
    await client.licenseKey.create({ data: record })
    return 'created-in-keys/bootstrap-admin-license.json'
  } catch { throw new Error('Licence admin initiale : échec. Le candidat local est conservé pour reprise, aucune licence existante remplacée.') }
  finally { if (client) await client.$disconnect().catch(() => {}) }
}
module.exports = { DEFAULT_SERVER_URL, configureServerEndpoint, run, inspectDatabase, inspectDesktop, ensureDesktopDatabase, configureUpstash, createFreeRedis, testRedis, publicFingerprint,
  configureKeygen, patchClientDefaults, assertExternalFile, installPublisherKey, buildAdminLicense, bootstrapAdmin,
  BOOKKEEPING_TABLE, isBookkeepingTable, businessTableNames }

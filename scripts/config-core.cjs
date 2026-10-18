'use strict'
// Pure helpers: no network, no writes on import, no dependency installation.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DEFAULTS = {
  RATE_LIMIT_LOGIN_MAX: '10', RATE_LIMIT_LOGIN_WINDOW_SECONDS: '900',
  RATE_LIMIT_LICENSE_ACTIVATE_MAX: '5', RATE_LIMIT_LICENSE_ACTIVATE_WINDOW_SECONDS: '900',
  RATE_LIMIT_LICENSE_STATUS_MAX: '60', RATE_LIMIT_LICENSE_STATUS_WINDOW_SECONDS: '60',
  RATE_LIMIT_ADMIN_MAX: '60', RATE_LIMIT_ADMIN_WINDOW_SECONDS: '60',
  RATE_LIMIT_API_MAX: '120', RATE_LIMIT_API_WINDOW_SECONDS: '60',
  UPSTASH_REDIS_TIMEOUT_MS: '1500', GF_UPDATE_CHANNEL: 'stable',
  GF_INTEGRITY_MODE: 'audit', GF_ANTIDEBUG: '0',
  EINVOICING_ENABLED: 'false', EINVOICING_PROVIDER_CATALOG_ENABLED: 'true',
  EINVOICING_CONNECTIONS_ENABLED: 'false', EINVOICING_OUTGOING_ENABLED: 'false',
  EINVOICING_INCOMING_ENABLED: 'false', EINVOICING_PAYMENT_REPORTING_ENABLED: 'false',
  EINVOICING_SANDBOX_ONLY: 'true', EINVOICING_DEFAULT_ENVIRONMENT: 'sandbox',
  GF_EINVOICE_CREDENTIALS_KEY_VERSION: '1', GF_MAX_MECHANIC_KEYS: '20',
  GF_MECHANIC_TIMER_AUTOCOMPLETE: '0', GARAGEFLOW_LLM: 'off',
}
const DESKTOP = new Set(['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET',
  'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL', 'GF_INTEGRITY_MODE',
  'GF_ANTIDEBUG', 'GF_SMTP_CIPHER_KEY', 'GF_SMTP_CIPHER_KEY_OLD', 'GF_BACKUP_KEY',
  'GF_SIGNATURE_SECRET', 'GF_DB_MAC_SECRET', 'LICENSE_ENFORCEMENT', 'GF_APP_URL',
  'GF_TOTP_ENC_KEY', 'GF_TOTP_ENC_KEY_OLD', 'ANTHROPIC_API_KEY', 'GARAGEFLOW_LLM', 'GARAGEFLOW_LLM_MODEL', 'GF_MAX_MECHANIC_KEYS',
  'GF_MECHANIC_TIMER_AUTOCOMPLETE', 'GF_BACKUP_DIR', 'GF_PHOTOS_DIR'])
const DESKTOP_ONLY = new Set(['GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL',
  'GF_INTEGRITY_MODE', 'GF_ANTIDEBUG', 'LICENSE_ENFORCEMENT', 'GF_INTERNAL_EXPORT_KEY'])
const GENERATED = {
  NEXTAUTH_SECRET: 'base64', DEVICE_TOKEN_PEPPER: 'base64', GARAGEFLOW_API_KEY: 'hex',
  GF_DB_MAC_SECRET: 'hex', GF_PORTAL_SECRET: 'base64', GF_SIGNATURE_SECRET: 'base64',
  GF_BACKUP_KEY: 'base64', GF_INTERNAL_EXPORT_KEY: 'hex', GF_SMTP_CIPHER_KEY: 'base64',
  GF_TOTP_ENC_KEY: 'base64',
}
const PATH_VALUES = new Set(['GF_BACKUP_DIR', 'GF_PHOTOS_DIR'])
const AES = new Set(['GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_EINVOICE_CREDENTIALS_KEY'])
const ENUMS = {
  GARAGEFLOW_LLM: ['off', 'anthropic'], LICENSE_ENFORCEMENT: ['on', 'off'], GF_UPDATE_CHANNEL: ['stable', 'beta'],
  GF_INTEGRITY_MODE: ['audit', 'enforce', 'off'], GF_ANTIDEBUG: ['0', '1'],
  TRUST_PROXY_HEADERS: ['0', '1'], GF_MECHANIC_TIMER_AUTOCOMPLETE: ['0', '1'], EINVOICING_DEFAULT_ENVIRONMENT: ['sandbox', 'production'],
}

function templateNames(text) {
  return [...new Set([...text.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]))]
}
function namesForProfile(names, profile) {
  return names.filter(n => !['GF_UPDATE_SIGNING_KEY', 'GF_UPDATE_SIGNING_KEY_FILE'].includes(n) &&
    (profile === 'desktop' ? DESKTOP.has(n) : !DESKTOP_ONLY.has(n)))
}
function isSecret(name) {
  return /SECRET|KEY|TOKEN|PEPPER|PASSWORD|(?:^|_)PASS(?:_|$)|DSN|CREDENTIAL|AUTHORIZATION|DATABASE_URL|DIRECT_URL/i.test(name) &&
    name !== 'GF_EINVOICE_CREDENTIALS_KEY_VERSION'
}
function assertNodeVersion(version = process.versions.node) {
  const match = /^22\.(\d+)\.(\d+)$/.exec(version)
  if (!match || Number(match[1]) < 12) throw new Error('Node.js >=22.12.0 et <23 est requis pour config.')
}
function normalizeValue(name, value) {
  // Windows accepts forward slashes, including UNC paths. Avoid dotenv's \n/\r
  // interpretation of backslashes without rewriting arbitrary secret values.
  if (typeof value === 'string' && (PATH_VALUES.has(name) || (name === 'DATABASE_URL' && value.startsWith('file:')))) {
    return value.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/')
  }
  return value
}
function editableNames(env, selected, policy) {
  const reserved = new Set([...policy.manifest.variables.map(v => v.name),
    ...policy.manifest.platformProvided, ...Object.keys(policy.manifest.forbiddenAliases)])
  return [...new Set([...selected, ...Object.keys(env).filter(n => /^[\w.-]+$/.test(n) && !reserved.has(n))])]
}
function parseEnv(text) {
  const env = Object.create(null)
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^[ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('"')) {
      const quoted = v.match(/^"((?:\\.|[^"\\])*)"[ \t]*(?:#.*)?$/)
      if (!quoted) throw new Error(`${m[1]} : valeur env entre guillemets invalide.`)
      v = quoted[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\$/g, '$')
    } else if (v.startsWith("'") || v.startsWith('`')) {
      const quoted = v.startsWith("'") ? v.match(/^'([^']*)'[ \t]*(?:#.*)?$/) : v.match(/^`([^`]*)`[ \t]*(?:#.*)?$/)
      if (!quoted) throw new Error(`${m[1]} : valeur env entre guillemets invalide.`)
      v = quoted[1].replace(/\\\$/g, '$')
    } else v = v.replace(/[ \t]*#.*$/, '').trim()
    env[m[1]] = v
  }
  return env
}
function encodeValue(name, value) {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value) || (name === 'GF_PRIVATE_KEY' && /["\\]/.test(value))) {
    throw new Error(`${name} : valeur monoligne requise ; fournir les PEM en base64 ou via le fichier de clé.`)
  }
  const quote = !/["\\]/.test(value) ? '"' : !value.includes("'") ? "'" : !value.includes('`') ? '`' : null
  if (!quote) throw new Error(`${name} : combinaison de guillemets non représentable sans ambiguïté dans dotenv.`)
  return quote + value.replace(/\$/g, '\\$') + quote
}
function serializeEnv(env, names, profile) {
  const lines = ['# Généré par config — SECRETS LOCAUX, ne jamais committer.',
    `# Profil : ${profile}. Relancer node config --conserver-secrets pour compléter sans rotation.`,
    '# Les variables non applicables à ce profil ne sont pas exportées.', '']
  for (const name of names) {
    // Values are quoted below, but identifiers cannot be quoted in dotenv.
    // Do not let a provider/imported object key create a second assignment.
    if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) {
      throw new Error('Nom de variable environnement invalide.')
    }
    const v = normalizeValue(name, env[name])
    if (!v) lines.push(`# ${name}=`)
    else lines.push(`${name}=${encodeValue(name, v)}`)
  }
  return lines.join('\n') + '\n'
}
// Provider fields copied from dashboard snippets may include NAME="value".
// Do not normalize arbitrary passwords: their spaces/quotes may be significant.
const PASTABLE_INPUTS = new Set(['BLOB_READ_WRITE_TOKEN', 'DATABASE_URL', 'DIRECT_URL',
  'DATABASE_URL_UNPOOLED', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'NEXTAUTH_URL', 'GF_APP_URL'])
function normalizeInput(name, value) {
  if (!PASTABLE_INPUTS.has(name) || typeof value !== 'string') return value
  const text = value.trim()
  const invalid = () => {
    const error = new Error(`${name} : coller une valeur seule ou une seule ligne ${name}="valeur", sans autre variable.`)
    error.configSafe = true
    return error
  }
  if (/[\r\n\0]/.test(text)) throw invalid()
  const assignment = text.match(/^(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=/)
  // Readable provider tokens do not have an uppercase NAME= envelope.
  if (assignment && assignment[1] !== name && PASTABLE_INPUTS.has(assignment[1])) throw invalid()
  if (assignment?.[1] !== name && !/^["'`]/.test(text)) return text
  try { return parseEnv(assignment?.[1] === name ? text : `${name}=${text}`)[name] ?? '' }
  catch { throw invalid() }
}
function readEnv(file) {
  try { return parseEnv(fs.readFileSync(file, 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return Object.create(null); throw new Error('Fichier env illisible.') }
}
function writePrivate(file, text, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  // Refuse symlinks, exclusive temporary file, atomic replacement; never leave a backup of secrets.
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Lien symbolique refusé pour un fichier secret.') }
  catch (e) { if (e.code !== 'ENOENT') throw e }
  if (exclusive) {
    // O_EXCL refuses existing files/symlinks, including concurrent first-install writers.
    fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(file, 0o600)
    return
  }
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, file)
    fs.chmodSync(file, 0o600)
  } finally { fs.rmSync(tmp, { force: true }) }
}
function saveDatabaseUrls(file, env) {
  let original = ''
  try { original = fs.readFileSync(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw new Error('Profil serveur illisible, aucune URL sauvegardée.') }
  if (original.includes('\0')) throw new Error('Profil serveur : encodage UTF-8 requis, aucune valeur remplacée.')
  const local = parseEnv(original)
  const missing = ['DATABASE_URL', 'DIRECT_URL'].filter(name => !local[name])
  if (!missing.length) return []
  const pair = Object.fromEntries(['DATABASE_URL', 'DIRECT_URL'].map(name => [name, local[name] || env[name]]))
  const issues = validate(pair, 'pwa', { vercel: true }).filter(message => message.startsWith('DATABASE_URL') || message.startsWith('DIRECT_URL'))
  if (issues.length) throw new Error(issues.join(' '))
  // Append only missing URLs: comments, unrelated secrets and existing URLs stay intact.
  const addition = serializeEnv(pair, missing, 'pwa')
  let current = ''
  try { current = fs.readFileSync(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw new Error('Profil serveur illisible.') }
  if (current !== original) throw new Error('Profil serveur modifié pendant la récupération ; sauvegarde annulée.')
  writePrivate(file, original + (original && !original.endsWith('\n') ? '\n' : '') + addition)
  return missing
}
// Secrets symétriques absents pour un profil : candidats à la génération automatique.
// Un secret DÉJÀ présent (même faible) n'est jamais remplacé ici.
function missingGenerated(env, names) {
  return names.filter(n => GENERATED[n] && !env[n])
}
// Génère les secrets absents des seules variables SYMÉTRIQUES (GENERATED).
// Retourne les noms générés, jamais les valeurs.
function generateMissing(env, names) {
  const created = []
  for (const name of missingGenerated(env, names)) {
    env[name] = crypto.randomBytes(32).toString(GENERATED[name])
    created.push(name)
  }
  return created
}
// Une clé demandée par un prompt peut être déclarée jamais utilisée ou générée
// explicitement : ces deux réponses ne sont jamais une valeur de secret.
const KEY_PROMPT_COMMANDS = { declaredUnused: 'NONUTILISE', generate: 'GENERER' }
function isKeyPromptCommand(value, command) {
  return String(value ?? '').trim().toUpperCase() === KEY_PROMPT_COMMANDS[command]
}
// Destination réelle de chaque secret généré, par profil. Sert au récapitulatif
// affiché à l'opérateur : aucune valeur, uniquement où la clé est écrite/lue.
const KEY_DESTINATIONS = {
  NEXTAUTH_SECRET: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  DEVICE_TOKEN_PEPPER: { server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GARAGEFLOW_API_KEY: { server: ['.env.server.local', 'keys/server_config.json (keygen)', 'Vercel production (Sensitive)'] },
  GF_DB_MAC_SECRET: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_PORTAL_SECRET: { server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_SIGNATURE_SECRET: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_BACKUP_KEY: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)', 'sauvegardes chiffrées locales/cloud'] },
  GF_SMTP_CIPHER_KEY: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_TOTP_ENC_KEY: { desktop: ['.env (desktop)'], server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_EINVOICE_CREDENTIALS_KEY: { server: ['.env.server.local', 'Vercel production (Sensitive)'] },
  GF_PRIVATE_KEY: { server: ['.env.server.local (base64)', 'keys/private.pem + keys/public.pem', 'ancrages publics (Next + Electron)'] },
}
function keyDestinations(name, profile = 'server') {
  const entry = KEY_DESTINATIONS[name]
  if (!entry) return []
  const destinations = profile === 'desktop' ? entry.desktop : entry.server
  return destinations ? [...destinations] : []
}
function fillMissing(env, names, profile) {
  const result = { ...env }
  for (const n of names) {
    if (result[n]) continue // Never silently repair/rotate a nonempty secret.
    if (GENERATED[n]) result[n] = crypto.randomBytes(32).toString(GENERATED[n])
    else if (DEFAULTS[n]) result[n] = DEFAULTS[n]
  }
  if (profile === 'desktop') {
    result.DATABASE_URL ||= 'file:./dev.db'
    result.NEXTAUTH_URL ||= 'http://localhost:4028'
  }
  return result
}
function urlValid(v, protocols, { publicEndpoint = false } = {}) {
  try { const u = new URL(v); return protocols.includes(u.protocol) && !!u.hostname && !/[\s"'\\]/.test(v) &&
    (!publicEndpoint || (!u.username && !u.password && !u.search && !u.hash)) }
  catch { return false }
}
function aesValid(v) {
  return /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32
}
function licenseKeyMatches(value, publicPem) {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
    const key = crypto.createPrivateKey(Buffer.from(value, 'base64').toString('utf8'))
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1' &&
      crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(
        crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' }))
  } catch { return false }
}
function embeddedLicenseKey(root) {
  const text = fs.readFileSync(path.join(root, 'src/lib/license/public-key.ts'), 'utf8')
  const block = text.match(/const\s+_LINES\s*=\s*\[([\s\S]*?)\]/)
  if (!block) throw new Error('Clé publique embarquée introuvable.')
  return [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n')
}
function validate(env, profile, { vercel = false, publicPem, allowLocalHttp = false, allowedBlobHashes } = {}) {
  const errors = []
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET']
  if (profile !== 'desktop') required.push('DIRECT_URL', 'NEXTAUTH_URL', 'DEVICE_TOKEN_PEPPER',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GF_DB_MAC_SECRET')
  if (profile === 'licences') required.push('GF_PRIVATE_KEY', 'GARAGEFLOW_API_KEY')
  if (env.EINVOICING_ENABLED === 'true') required.push('GF_EINVOICE_CREDENTIALS_KEY')
  for (const n of required) if (!env[n]) errors.push(`${n} : requis.`)
  for (const [n, raw] of Object.entries(env)) {
    const v = normalizeValue(n, raw)
    if (!v) continue
    try { encodeValue(n, v) } catch { errors.push(`${n} : valeur incompatible avec le fichier env (monoligne et guillemets dotenv requis).`) }
    if (GENERATED[n] && (v.trim().length < (n === 'GARAGEFLOW_API_KEY' || n === 'GF_INTERNAL_EXPORT_KEY' ? 16 : 32) ||
      /change.?me|placeholder|example|your-secret|votre_secret|replace_with|fallback-/i.test(v))) errors.push(`${n} : secret trop court ou générique (pas de rotation automatique).`)
    if (AES.has(n) && !aesValid(v)) errors.push(`${n} : 32 octets en base64 requis.`)
    if (n === 'GF_SMTP_CIPHER_KEY_OLD' && !v.split(',').every(k => aesValid(k.trim()))) errors.push(`${n} : anciennes clés AES base64 invalides.`)
    if (n === 'GF_TOTP_ENC_KEY_OLD' && !v.split(',').every(k => k.trim().length >= 16)) errors.push(`${n} : anciennes clés TOTP trop courtes.`)
    if ((n.startsWith('RATE_LIMIT_') || ['GF_MAX_MECHANIC_KEYS', 'GF_KEYGEN_MAX_MECHANIC'].includes(n)) && (!/^\d+$/.test(v) || Number(v) < 1 || !Number.isSafeInteger(Number(v)))) errors.push(`${n} : entier positif requis.`)
    if (n === 'UPSTASH_REDIS_TIMEOUT_MS' && (!/^\d+$/.test(v) || +v < 100 || +v > 10000)) errors.push(`${n} : entier entre 100 et 10000 requis.`)
    if (ENUMS[n] && !ENUMS[n].includes(v)) errors.push(`${n} : ${ENUMS[n].join(' | ')}.`)
    if (/^EINVOICING_.*_ENABLED$|^EINVOICING_ENABLED$|^EINVOICING_SANDBOX_ONLY$/.test(n) && !['true', 'false'].includes(v)) errors.push(`${n} : true | false.`)
    if (n === 'GF_EINVOICE_CREDENTIALS_KEY_VERSION' && (!/^\d+$/.test(v) || +v < 1)) errors.push(`${n} : version positive requise.`)
    if (/^GF_MIN_(ELECTRON|PWA)_VERSION$/.test(n) && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) errors.push(`${n} : version x.y.z requise.`)
    if (n === 'GF_DEVICE_AUTH_DEADLINE' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v)))) errors.push(`${n} : date RFC3339 requise.`)
    let localHttp = false
    if (allowLocalHttp && ['NEXTAUTH_URL', 'GF_APP_URL'].includes(n)) {
      try { const url = new URL(v); localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash } catch { /* validate below */ }
    }
    if (['NEXTAUTH_URL', 'GF_APP_URL', 'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'UPSTASH_REDIS_REST_URL'].includes(n) && !localHttp &&
      !urlValid(v, profile === 'desktop' && !['UPSTASH_REDIS_REST_URL', 'GF_APP_URL'].includes(n) ? ['http:', 'https:'] : ['https:'], { publicEndpoint: true })) errors.push(`${n} : URL ${profile === 'desktop' ? 'HTTP(S)' : 'HTTPS'} sans identifiants, query ni fragment requise.`)
    if (['DATABASE_URL', 'DIRECT_URL'].includes(n) && !(profile === 'desktop' && n === 'DATABASE_URL' ? /^file:.+/.test(v) : urlValid(v, ['postgres:', 'postgresql:']))) errors.push(`${n} : ${profile === 'desktop' ? 'SQLite file:' : 'PostgreSQL'} requis.`)
    if (n === 'DIRECT_URL' && urlValid(v, ['postgres:', 'postgresql:']) && /-pooler\./i.test(new URL(v).hostname)) errors.push(`${n} : URL directe requise (pas -pooler).`)
  }
  if (profile !== 'desktop' && !vercel && env.TRUST_PROXY_HEADERS !== '1') errors.push('TRUST_PROXY_HEADERS : déclarer 1 uniquement derrière un proxy fiable, ou choisir Vercel.')
  if (profile !== 'desktop' && urlValid(env.DATABASE_URL || '', ['postgres:', 'postgresql:']) && urlValid(env.DIRECT_URL || '', ['postgres:', 'postgresql:'])) {
    const runtime = new URL(env.DATABASE_URL), direct = new URL(env.DIRECT_URL)
    if (runtime.pathname !== direct.pathname || (runtime.searchParams.get('schema') || 'public') !== (direct.searchParams.get('schema') || 'public')) errors.push('DATABASE_URL / DIRECT_URL : doivent viser la même base et le même schéma.')
    if (runtime.hostname.endsWith('.neon.tech') && runtime.hostname.replace(/-pooler(?=\.)/, '') !== direct.hostname) errors.push('DATABASE_URL / DIRECT_URL : endpoints Neon de branches différentes, vérifiez les accès.')
  }
  if (env.GARAGEFLOW_API_KEY && env.NEXTAUTH_SECRET && env.GARAGEFLOW_API_KEY === env.NEXTAUTH_SECRET) errors.push('GARAGEFLOW_API_KEY : doit être distincte de NEXTAUTH_SECRET.')
  if (vercel && (env.GF_BACKUP_DIR || env.GF_PHOTOS_DIR)) errors.push('GF_BACKUP_DIR / GF_PHOTOS_DIR : stockage fichier non persistant sur Vercel ; ne pas simuler un disque durable.')
  if (env.GF_PRIVATE_KEY && (!publicPem || !licenseKeyMatches(env.GF_PRIVATE_KEY, publicPem))) errors.push('GF_PRIVATE_KEY : clé P-256 incompatible avec la clé publique embarquée.')
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'compromised-secrets.json'), 'utf8')).entries
  const { compromised, permittedBlob } = require('./lib/config-credentials.cjs')
  for (const [name, value] of Object.entries(env)) if (compromised(value, entries) && !permittedBlob(name, value, allowedBlobHashes)) errors.push(`${name} : identifiant connu exposé ; renouvellement fournisseur obligatoire.`)
  return [...new Set(errors)]
}
function syncPlan(local, remote, names) {
  const additions = [], conflicts = []
  for (const n of names) {
    if (!local[n]) continue
    if (!remote[n]) additions.push(n)
    else if (local[n] !== remote[n]) conflicts.push(n)
  }
  return { additions, conflicts }
}
module.exports = { DEFAULTS, GENERATED, assertNodeVersion, normalizeValue, normalizeInput, editableNames, templateNames, namesForProfile, isSecret, parseEnv,
  serializeEnv, readEnv, writePrivate, saveDatabaseUrls, fillMissing, missingGenerated, generateMissing,
  KEY_PROMPT_COMMANDS, isKeyPromptCommand, KEY_DESTINATIONS, keyDestinations, validate, licenseKeyMatches,
  embeddedLicenseKey, syncPlan }

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
  GF_EINVOICE_CREDENTIALS_KEY_VERSION: '1',
}
const DESKTOP = new Set(['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET',
  'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL', 'GF_INTEGRITY_MODE',
  'GF_ANTIDEBUG', 'GF_SMTP_CIPHER_KEY', 'GF_SMTP_CIPHER_KEY_OLD', 'GF_BACKUP_KEY',
  'GF_SIGNATURE_SECRET', 'GF_DB_MAC_SECRET', 'LICENSE_ENFORCEMENT'])
const DESKTOP_ONLY = new Set(['GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'GF_UPDATE_CHANNEL',
  'GF_INTEGRITY_MODE', 'GF_ANTIDEBUG', 'LICENSE_ENFORCEMENT'])
const GENERATED = {
  NEXTAUTH_SECRET: 'base64', DEVICE_TOKEN_PEPPER: 'base64', GARAGEFLOW_API_KEY: 'hex',
  GF_DB_MAC_SECRET: 'hex', GF_PORTAL_SECRET: 'base64', GF_SIGNATURE_SECRET: 'base64',
  GF_BACKUP_KEY: 'base64', GF_INTERNAL_EXPORT_KEY: 'hex', GF_SMTP_CIPHER_KEY: 'base64',
}
const AES = new Set(['GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_EINVOICE_CREDENTIALS_KEY'])
const ENUMS = {
  LICENSE_ENFORCEMENT: ['on', 'off'], GF_UPDATE_CHANNEL: ['stable', 'beta'],
  GF_INTEGRITY_MODE: ['audit', 'enforce', 'off'], GF_ANTIDEBUG: ['0', '1'],
  TRUST_PROXY_HEADERS: ['0', '1'], EINVOICING_DEFAULT_ENVIRONMENT: ['sandbox', 'production'],
}

function templateNames(text) {
  return [...new Set([...text.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]))]
}
function namesForProfile(names, profile) {
  return names.filter(n => n !== 'GF_UPDATE_SIGNING_KEY' &&
    (profile === 'desktop' ? DESKTOP.has(n) : !DESKTOP_ONLY.has(n)))
}
function isSecret(name) {
  return /SECRET|KEY|TOKEN|PEPPER|DATABASE_URL|DIRECT_URL/.test(name) &&
    name !== 'GF_EINVOICE_CREDENTIALS_KEY_VERSION'
}
function parseEnv(text) {
  const env = Object.create(null)
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('"')) {
      const quoted = v.match(/^"((?:\\.|[^"\\])*)"[ \t]*(?:#.*)?$/)
      if (!quoted) throw new Error(`${m[1]} : valeur env entre guillemets invalide.`)
      v = quoted[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\$/g, '$').replace(/\\"/g, '"')
    } else if (v.startsWith("'")) {
      const quoted = v.match(/^'([^']*)'[ \t]*(?:#.*)?$/)
      if (!quoted) throw new Error(`${m[1]} : valeur env entre guillemets invalide.`)
      v = quoted[1]
    } else v = v.replace(/[ \t]*#.*$/, '').trim()
    env[m[1]] = v
  }
  return env
}
function serializeEnv(env, names, profile) {
  const lines = ['# Généré par config — SECRETS LOCAUX, ne jamais committer.',
    `# Profil : ${profile}. Relancer npm run config pour compléter, sans rotation.`,
    '# Les variables non applicables à ce profil ne sont pas exportées.', '']
  for (const name of names) {
    const v = env[name]
    if (!v) lines.push(`# ${name}=`)
    else {
      if (/["\\\r\n]/.test(v)) throw new Error(`${name} : caractères non pris en charge dans le fichier env.`)
      lines.push(`${name}="${v.replace(/\$/g, '\\$')}"`)
    }
  }
  return lines.join('\n') + '\n'
}
function readEnv(file) {
  try { return parseEnv(fs.readFileSync(file, 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return Object.create(null); throw new Error('Fichier env illisible.') }
}
function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  // Refuse symlinks, exclusive temporary file, atomic replacement; never leave a backup of secrets.
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Lien symbolique refusé pour un fichier secret.') }
  catch (e) { if (e.code !== 'ENOENT') throw e }
  const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, file)
    fs.chmodSync(file, 0o600)
  } finally { fs.rmSync(tmp, { force: true }) }
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
function urlValid(v, protocols) {
  try { const u = new URL(v); return protocols.includes(u.protocol) && !!u.hostname && !/[\s"'\\]/.test(v) }
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
function validate(env, profile, { vercel = false, publicPem } = {}) {
  const errors = []
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET']
  if (profile !== 'desktop') required.push('DIRECT_URL', 'NEXTAUTH_URL', 'DEVICE_TOKEN_PEPPER',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GF_DB_MAC_SECRET')
  if (profile === 'licences') required.push('GF_PRIVATE_KEY', 'GARAGEFLOW_API_KEY')
  if (env.EINVOICING_ENABLED === 'true') required.push('GF_EINVOICE_CREDENTIALS_KEY')
  for (const n of required) if (!env[n]) errors.push(`${n} : requis.`)
  for (const [n, v] of Object.entries(env)) {
    if (!v) continue
    if (/["\\\r\n]/.test(v)) errors.push(`${n} : caractères incompatibles avec le fichier env.`)
    if (GENERATED[n] && (v.trim().length < (n === 'GARAGEFLOW_API_KEY' || n === 'GF_INTERNAL_EXPORT_KEY' ? 16 : 32) ||
      /change.?me|placeholder|example|your-secret|votre_secret|replace_with|fallback-/i.test(v))) errors.push(`${n} : secret trop court ou générique (pas de rotation automatique).`)
    if (AES.has(n) && !aesValid(v)) errors.push(`${n} : 32 octets en base64 requis.`)
    if (n === 'GF_SMTP_CIPHER_KEY_OLD' && !v.split(',').every(k => aesValid(k.trim()))) errors.push(`${n} : anciennes clés AES base64 invalides.`)
    if (n.startsWith('RATE_LIMIT_') && (!/^\d+$/.test(v) || Number(v) < 1 || !Number.isSafeInteger(Number(v)))) errors.push(`${n} : entier positif requis.`)
    if (n === 'UPSTASH_REDIS_TIMEOUT_MS' && (!/^\d+$/.test(v) || +v < 100 || +v > 10000)) errors.push(`${n} : entier entre 100 et 10000 requis.`)
    if (ENUMS[n] && !ENUMS[n].includes(v)) errors.push(`${n} : ${ENUMS[n].join(' | ')}.`)
    if (/^EINVOICING_.*_ENABLED$|^EINVOICING_ENABLED$|^EINVOICING_SANDBOX_ONLY$/.test(n) && !['true', 'false'].includes(v)) errors.push(`${n} : true | false.`)
    if (n === 'GF_EINVOICE_CREDENTIALS_KEY_VERSION' && (!/^\d+$/.test(v) || +v < 1)) errors.push(`${n} : version positive requise.`)
    if (/^GF_MIN_(ELECTRON|PWA)_VERSION$/.test(n) && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) errors.push(`${n} : version x.y.z requise.`)
    if (n === 'GF_DEVICE_AUTH_DEADLINE' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v)))) errors.push(`${n} : date RFC3339 requise.`)
    if (['NEXTAUTH_URL', 'GF_LICENSE_SERVER', 'GF_UPDATE_SERVER', 'UPSTASH_REDIS_REST_URL'].includes(n) &&
      !urlValid(v, profile === 'desktop' && n !== 'UPSTASH_REDIS_REST_URL' ? ['http:', 'https:'] : ['https:'])) errors.push(`${n} : URL ${profile === 'desktop' ? 'HTTP(S)' : 'HTTPS'} requise.`)
    if (['DATABASE_URL', 'DIRECT_URL'].includes(n) && !(profile === 'desktop' && n === 'DATABASE_URL' ? /^file:.+/.test(v) : urlValid(v, ['postgres:', 'postgresql:']))) errors.push(`${n} : ${profile === 'desktop' ? 'SQLite file:' : 'PostgreSQL'} requis.`)
    if (n === 'DIRECT_URL' && /-pooler\./i.test(v)) errors.push(`${n} : URL directe requise (pas -pooler).`)
  }
  if (profile !== 'desktop' && !vercel && env.TRUST_PROXY_HEADERS !== '1') errors.push('TRUST_PROXY_HEADERS : déclarer 1 uniquement derrière un proxy fiable, ou choisir Vercel.')
  if (env.GF_PRIVATE_KEY && (!publicPem || !licenseKeyMatches(env.GF_PRIVATE_KEY, publicPem))) errors.push('GF_PRIVATE_KEY : clé P-256 incompatible avec la clé publique embarquée.')
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
module.exports = { DEFAULTS, GENERATED, templateNames, namesForProfile, isSecret, parseEnv,
  serializeEnv, readEnv, writePrivate, fillMissing, validate, licenseKeyMatches,
  embeddedLicenseKey, syncPlan }

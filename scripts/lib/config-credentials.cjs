'use strict'
function failure(message) { const error = new Error(message); error.configSafe = true; return error }
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const core = require('../config-core.cjs')
const NEON_REFERENCE = Object.freeze({ user: 'neondb_owner', database: 'neondb', region: 'us-east-2',
  pooled: 'ep-aged-cell-ayqiwroc-pooler.c-5.us-east-2.aws.neon.tech',
  direct: 'ep-aged-cell-ayqiwroc.c-5.us-east-2.aws.neon.tech' })
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex')
function compromised(value, entries) {
  if (typeof value !== 'string' || !value) return false
  const candidates = [value]
  try { const u = new URL(value); if (u.password) candidates.push(decodeURIComponent(u.password)) } catch { /* not a URL */ }
  return candidates.some(candidate => entries.some(e => hash(candidate).startsWith(e.sha256Prefix)))
}
function cleanCredentials(values, entries) {
  const safe = {}, rejected = []
  for (const [name, value] of Object.entries(values)) {
    if (compromised(value, entries)) rejected.push(name)
    else safe[name] = value
  }
  return { safe, rejected }
}
function neonVariables(password, reference = NEON_REFERENCE) {
  if (typeof password !== 'string' || !password || /[\r\n\0]/.test(password)) throw failure('Neon : nouveau mot de passe réel requis.')
  const url = host => {
    if (!/^[a-zA-Z0-9.-]+\.neon\.tech$/.test(host)) throw failure('Neon : hôte invalide.')
    // The input is a RAW password. Encode exactly once, including literal %.
    return `postgresql://${encodeURIComponent(reference.user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(reference.database)}`
  }
  const pooled = url(reference.pooled), direct = url(reference.direct)
  return { DATABASE_URL: `${pooled}?channel_binding=require&sslmode=require`,
    DIRECT_URL: `${direct}?sslmode=require`, DATABASE_URL_UNPOOLED: `${direct}?sslmode=require`,
    PGHOST: reference.pooled, PGHOST_UNPOOLED: reference.direct, PGUSER: reference.user,
    PGDATABASE: reference.database, PGPASSWORD: password,
    POSTGRES_URL: `${pooled}?channel_binding=require&sslmode=require`,
    POSTGRES_URL_NON_POOLING: `${direct}?channel_binding=require&sslmode=require`,
    POSTGRES_USER: reference.user, POSTGRES_HOST: reference.pooled, POSTGRES_PASSWORD: password,
    POSTGRES_DATABASE: reference.database, POSTGRES_URL_NO_SSL: pooled,
    POSTGRES_PRISMA_URL: `${pooled}?channel_binding=require&connect_timeout=15&sslmode=require` }
}
function postgresIssues(env) {
  try {
    const a = new URL(env.DATABASE_URL), b = new URL(env.DIRECT_URL)
    for (const u of [a, b]) {
      if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname.endsWith('.neon.tech') || !u.username || !u.password || u.hash ||
        !['require', 'verify-ca', 'verify-full'].includes(u.searchParams.get('sslmode'))) return ['DATABASE_URL / DIRECT_URL : Neon avec SSL obligatoire.']
      decodeURIComponent(u.password) // malformed percent escapes must not reach a driver
    }
    if (a.pathname !== b.pathname || a.username !== b.username || a.password !== b.password ||
      (a.searchParams.get('schema') || 'public') !== (b.searchParams.get('schema') || 'public') ||
      a.hostname.replace(/-pooler\./, '.') !== b.hostname || /-pooler\./.test(b.hostname)) return ['DATABASE_URL / DIRECT_URL : même branche, base, rôle et mot de passe ; URL directe sans pooler.']
    if (env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED !== env.DIRECT_URL) return ['DATABASE_URL_UNPOOLED : doit correspondre exactement à DIRECT_URL.']
    return []
  } catch { return ['DATABASE_URL / DIRECT_URL : URLs PostgreSQL invalides.'] }
}
function gitProtection(root, destinations) {
  let tracked
  try { tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean) }
  catch { throw failure('Git : inventaire impossible ; aucune écriture autorisée.') }
  const isExample = name => /(?:^|\/)\.env(?:\.[\w-]+)*\.example$/.test(name)
  const leaks = tracked.filter(name => /(?:^|\/)\.env(?:\.|$)/.test(name) && !isExample(name))
  const unsafeExamples = []
  for (const name of tracked.filter(isExample)) {
    const env = core.readEnv(path.join(root, name))
    for (const [key, value] of Object.entries(env)) {
      let password = false
      try { password = !!new URL(value).password } catch { /* not a URL */ }
      if (value && ((core.isSecret(key) && !(key === 'DATABASE_URL' && value.startsWith('file:'))) || password)) unsafeExamples.push(key)
    }
  }
  const unignored = destinations.filter(name => {
    try { execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', name], { cwd: root, stdio: 'ignore' }); return false }
    catch { return true }
  })
  const symlinks = destinations.filter(name => name.split(/[\\/]/).some((_, i, parts) => { try { return fs.lstatSync(path.join(root, ...parts.slice(0, i + 1))).isSymbolicLink() } catch { return false } }))
  return { ok: !leaks.length && !unsafeExamples.length && !unignored.length && !symlinks.length,
    trackedSecretFiles: leaks, unsafeExamples: [...new Set(unsafeExamples)], unignored, symlinks }
}
module.exports = { NEON_REFERENCE, hash, compromised, cleanCredentials, neonVariables, postgresIssues, gitProtection }

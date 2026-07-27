'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Electron Main Process v2
//
//  License system: ECC P-256 / ECDSA-SHA256
//    • Private key stays on the server (keygen.py)
//    • Public key is embedded below — replace after: python scripts/keygen.py --init
//    • License token validated locally (ECDSA, no internet required)
//    • On success: cookies injected via session API → Next.js middleware passes
//
//  Flow:
//    1. Splash screen
//    2. Database setup (copy template to userData on first run)
//    3. License check (local ECC token validation)
//    4. If not licensed: native license window (blocks until activated or quit)
//    5. Inject license cookies into Electron session
//    6. Start Next.js standalone server (port 4028)
//    7. Open main window → splash closes
//    8. Auto-backup every hour
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session, utilityProcess } = require('electron')
const path    = require('path')
const fs      = require('fs')
const http    = require('http')
const crypto  = require('crypto')
const os      = require('os')

// Silence EPIPE on stdout/stderr so packaged app never crashes when no terminal is attached
try { process.stdout.on('error', () => {}) } catch (_) {}
try { process.stderr.on('error', () => {}) } catch (_) {}

// ── Load .env for dev mode (Next.js reads it automatically, Electron doesn't) ─
;(function loadDotEnv() {
  const root    = path.join(__dirname, '..')
  const envFile = path.join(root, '.env')

  // Auto-create .env if missing — prevents "blue screen" on fresh clone in dev
  if (!fs.existsSync(envFile)) {
    try {
      const example = path.join(root, '.env.example')
      if (fs.existsSync(example)) {
        fs.copyFileSync(example, envFile)
      } else {
        fs.writeFileSync(envFile, [
          'DATABASE_URL="file:./dev.db"',
          'NEXTAUTH_URL="http://localhost:3000"',
          'NEXTAUTH_SECRET="gf-electron-local-secret-2026-xK9mP3qR"',
          '',
        ].join('\n'), 'utf8')
      }
    } catch (_) { return }
  }

  try {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch (_) {}
})()

// Must be set before app is ready — enables Windows taskbar icon + pinning
app.setAppUserModelId('com.garageflow.app')

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_DEV      = process.env.ELECTRON_DEV === '1'
const PORT        = 4028
const APP_DATA    = app.getPath('userData')
const DB_PATH     = path.join(APP_DATA, 'garageflow.db')
const LIC_PATH    = path.join(APP_DATA, 'gf_license.dat')   // AES-GCM encrypted
const BAK_DIR     = path.join(APP_DATA, 'backups')
const BAK_HOURLY  = path.join(BAK_DIR, 'hourly')
const BAK_DAILY   = path.join(BAK_DIR, 'daily')
const BAK_WEEKLY  = path.join(BAK_DIR, 'weekly')
const LOG_PATH    = path.join(APP_DATA, 'garageflow.log')
const PHOTOS_DIR  = path.join(APP_DATA, 'photos')
const ROOT     = path.join(__dirname, '..')               // project root (dev) or app dir (prod)

// ── Embedded ECC Public Key (P-256 / secp256r1) ───────────────────────────────
// Generated ONCE by: python scripts\keygen.py --init
// Replace the placeholder lines below with YOUR generated public key lines.
// This is a PUBLIC key — distributing it is safe; you cannot forge signatures without private.pem
const _PK = [
  '-----BEGIN PUBLIC KEY-----',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDvMVU9vdgTvQu1S2w6amt5UyFWhR',
  'E+KEHZzdx5v4WLubA5mSjFdI6TS1L67Qq8ulJ9fUoOF6n2zzKO7o6DbbgA==',
  '-----END PUBLIC KEY-----',
]
const PUBLIC_KEY_PEM = _PK.join('\n')

// ── Control-plane helpers (modules, crashs, clock-tamper, notifications) ──────
const cp = require('./control-plane')

const SETTINGS_PATH     = path.join(APP_DATA, 'gf_settings.json')       // crash consent, prefs
const ENTITLEMENTS_PATH = path.join(APP_DATA, 'gf_entitlements.dat')    // AES-GCM (HWID key)
const CRASH_QUEUE_PATH  = path.join(APP_DATA, 'gf_crash_queue.json')    // offline crash queue
const TRUSTED_CLOCK_PATH= path.join(APP_DATA, 'gf_clock.json')          // trusted-time reference
const UPDATE_CHANNEL    = (process.env.GF_UPDATE_CHANNEL || 'stable').trim() || 'stable'
const CLOCK_SKEW_MS     = 15 * 60 * 1_000                               // 15 min tolerance

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow        = null
let currentModules    = []      // effective module keys from the server (entitlements)
let currentNotifs     = []      // notifications from the server
let breadcrumbs       = []      // last user actions before a crash (bounded)
let clockTampered     = false   // set when a backward clock jump is detected
let splashWindow      = null
let nextServer        = null
let backupTimer       = null
let licenseTimer      = null    // periodic revocation check (adaptive interval)
let licenseBlocked    = false   // true while access is blocked (revoked/suspended/tampered)
let licenseCheckStarted = false // guards against starting the poll loop twice
let activeLicense     = null   // { token, payload } — set after validation
let desktopExportTimer = null
let onlineCheckTimer  = null   // periodic internet connectivity check

// One-time secret for internal API calls (export endpoint)
const INTERNAL_EXPORT_KEY = crypto.randomBytes(32).toString('hex')

// ── Online check state ────────────────────────────────────────────────────────
const ONLINE_CHECK_FILE    = () => path.join(APP_DATA, 'last_online.json')
const GRACE_PERIOD_MS      = 48 * 60 * 60 * 1_000   // 48 hours
const LOCK_PERIOD_MS       = 72 * 60 * 60 * 1_000   // 72 hours (lock after grace)
const ONLINE_CHECK_URL     = 'https://1.1.1.1'       // Cloudflare DNS — very reliable

// ── Logging ───────────────────────────────────────────────────────────────────

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try { process.stdout.write(line) } catch (_) {}   // EPIPE-safe: no terminal in packaged app
  try { fs.appendFileSync(LOG_PATH, line) } catch (_) {}
}

// ── Anti-debug (non-fatal in dev mode) ────────────────────────────────────────

function checkDebugger() {
  try {
    const inspector = require('inspector')
    if (inspector.url()) {
      if (!IS_DEV) {
        log('SECURITY: debugger detected — aborting')
        app.quit()
        process.exit(1)
      }
      log('DEV: debugger attached (allowed in dev mode)')
    }
  } catch (_) {}

  const flags = process.execArgv.join(' ')
  if ((flags.includes('--inspect') || flags.includes('--debug')) && !IS_DEV) {
    log('SECURITY: debug flag detected — aborting')
    app.quit()
    process.exit(1)
  }
}

// ── Hardware fingerprint ──────────────────────────────────────────────────────

function getDiskSerial() {
  const { execSync } = require('child_process')
  try {
    if (os.platform() === 'win32') {
      const out = execSync('wmic diskdrive get serialnumber /format:list', { timeout: 3000 }).toString()
      for (const line of out.split('\n')) {
        const serial = line.replace('SerialNumber=', '').trim()
        if (serial) return serial
      }
    } else if (os.platform() === 'darwin') {
      const out = execSync('system_profiler SPStorageDataType 2>/dev/null | grep "Serial Number"', { timeout: 3000 }).toString()
      const m = out.match(/Serial Number:\s*(.+)/)
      if (m) return m[1].trim()
    } else {
      const out = execSync('lsblk -dno SERIAL 2>/dev/null | head -1', { timeout: 3000 }).toString().trim()
      if (out) return out
    }
  } catch { /* ignore */ }
  return 'unknown-disk'
}

function getHwid() {
  const cpu      = (os.cpus()[0]?.model ?? 'unknown').trim()
  const platform = `${os.platform()}-${os.arch()}`
  const hostname = crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16)
  const disk     = getDiskSerial()

  // First non-loopback MAC address
  let mac = 'unknown'
  outer: for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const net of (ifaces ?? [])) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac.toLowerCase()
        break outer
      }
    }
  }

  // Salt matches keygen_core.py exactly
  const combined = [cpu, mac, platform, hostname, disk].join('||GF2-HWID-SALT||')
  return crypto.createHash('sha256').update(combined).digest('hex')
}

// ── ECC License Verification (ECDSA-SHA256, P-256) ────────────────────────────

function b64uDecode(s) {
  const pad = (4 - s.length % 4) % 4
  return Buffer.from(s + '='.repeat(pad), 'base64url')
}

/**
 * Verify a GF2 license token using ECDSA-SHA256.
 * Returns the decoded payload, or null if invalid / expired.
 */
function verifyEccToken(token) {
  try {
    if (typeof token !== 'string' || !token.startsWith('GF2.')) return null

    const parts = token.trim().split('.')
    if (parts.length !== 4) return null

    const [, headerB64, payloadB64, sigB64] = parts

    // Detect placeholder public key
    if (PUBLIC_KEY_PEM.includes('REPLACE_WITH_YOUR_PUBLIC_KEY')) {
      log('WARNING: ECC public key not configured — using dev bypass')
      // In dev mode only: allow a special dev token that bypasses verification
      if (IS_DEV && token === 'GF2.DEV.DEV.DEV') {
        return { lid: 'dev', cid: 'DEV', typ: 'admin', iss: 0, exp: 9999999999, seats: 999, wm: '', ver: '2.0' }
      }
      return null
    }

    // Header check
    try {
      const header = JSON.parse(b64uDecode(headerB64).toString('utf8'))
      if (header.alg !== 'ES256' || header.typ !== 'GF-LIC') return null
    } catch { return null }

    // Signature verification
    const signingInput = `${headerB64}.${payloadB64}`
    const sig = b64uDecode(sigB64)
    const verifier = crypto.createVerify('SHA256')
    verifier.update(signingInput)
    if (!verifier.verify({ key: PUBLIC_KEY_PEM, format: 'pem' }, sig)) return null

    // Parse payload
    const payload = JSON.parse(b64uDecode(payloadB64).toString('utf8'))

    // Expiry check
    const nowSec = Math.floor(Date.now() / 1000)
    if (payload.exp < nowSec) {
      log('License expired at', new Date(payload.exp * 1000).toISOString())
      return null
    }

    // Required fields
    if (!payload.lid || !payload.cid || !payload.typ) return null

    return payload
  } catch (err) {
    log('ECC verify error:', err.message)
    return null
  }
}

// ── HWID tolerance check (75% match = OK for hardware upgrades) ───────────────

function hwidMatches(stored, current) {
  if (!stored) return true   // no binding
  if (stored === current) return true
  if (stored.length === 64 && current.length === 64) {
    let match = 0
    for (let i = 0; i < 64; i++) { if (stored[i] === current[i]) match++ }
    return match >= 48   // 75% threshold
  }
  return false
}

// ── License storage (AES-256-GCM, key derived from HWID via PBKDF2) ──────────

const LIC_SALT     = 'GarageFlow-License-Storage-Salt-v2'
const DB_MAC_SALT  = 'GarageFlow-DB-MAC-Salt-v1'

function deriveStorageKey() {
  const hwid = getHwid()
  return crypto.pbkdf2Sync(hwid, LIC_SALT, 100_000, 32, 'sha256')
}

/**
 * Derive a machine-specific secret for DB record MAC verification.
 * Fewer PBKDF2 iterations than storage key (this is called once at startup, not
 * on every request). The secret is passed to Next.js via GF_DB_MAC_SECRET env.
 */
function deriveDbMacSecret() {
  const hwid = getHwid()
  return crypto.pbkdf2Sync(hwid, DB_MAC_SALT, 10_000, 32, 'sha256').toString('hex')
}

function saveLicense(token, payload) {
  try {
    const key = deriveStorageKey()
    const iv  = crypto.randomBytes(12)
    const plain = JSON.stringify({
      token,
      payload,
      savedAt:    Date.now(),
      hwid:       getHwid(),
      appVersion: app.getVersion(),
    })
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()
    // File layout: IV(12) + AuthTag(16) + Ciphertext
    fs.writeFileSync(LIC_PATH, Buffer.concat([iv, tag, enc]))
    log('License saved — lid:', payload.lid, '| type:', payload.typ)
  } catch (err) {
    log('saveLicense error:', err.message)
  }
}

function loadLicense() {
  try {
    if (!fs.existsSync(LIC_PATH)) return null
    const buf = fs.readFileSync(LIC_PATH)
    if (buf.length <= 28) return null

    const iv  = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)

    const key      = deriveStorageKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plain    = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    return JSON.parse(plain)
  } catch {
    // Auth tag mismatch = tampered file; decrypt failure on new machine (HWID changed)
    return null
  }
}

// ── System info (télémétrie technique — jamais de donnée métier) ──────────────
function getSystemInfo() {
  const os = require('os')
  return {
    version: app.getVersion(),
    os:      `${os.platform()} ${os.release()}`.slice(0, 60),
    arch:    process.arch,
    cpu:     (os.cpus()?.[0]?.model ?? 'unknown').trim().slice(0, 120),
    ramMb:   Math.round(os.totalmem() / 1_048_576),
  }
}

// ── Settings (consentement crash, préférences) ────────────────────────────────
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch { return {} }
}
function writeSettings(patch) {
  try {
    const next = { ...readSettings(), ...patch }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next), 'utf8')
    return next
  } catch (err) { log('writeSettings error:', err.message); return readSettings() }
}
/** Consentement crash — par défaut activé (peut être coupé dans les paramètres). */
function crashConsent() {
  const s = readSettings()
  return s.crashConsent === undefined ? true : !!s.crashConsent
}

// ── Entitlements (modules) — cache chiffré, lié au HWID ───────────────────────
function saveEntitlements(modules) {
  try {
    const key = deriveStorageKey()
    const iv  = crypto.randomBytes(12)
    const plain = JSON.stringify({ modules: Array.isArray(modules) ? modules : [], savedAt: Date.now() })
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    fs.writeFileSync(ENTITLEMENTS_PATH, Buffer.concat([iv, cipher.getAuthTag(), enc]))
  } catch (err) { log('saveEntitlements error:', err.message) }
}
function loadEntitlements() {
  try {
    if (!fs.existsSync(ENTITLEMENTS_PATH)) return []
    const buf = fs.readFileSync(ENTITLEMENTS_PATH)
    if (buf.length <= 28) return []
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveStorageKey(), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
    const data = JSON.parse(plain)
    return Array.isArray(data.modules) ? data.modules : []
  } catch { return [] }
}
function broadcastEntitlements() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('entitlements:update', { modules: currentModules })
  }
}

// ── Trusted clock (anti recul d'horloge) ──────────────────────────────────────
function readTrustedClock() {
  try { return JSON.parse(fs.readFileSync(TRUSTED_CLOCK_PATH, 'utf8')) } catch { return null }
}
function writeTrustedClock(wall) {
  try { fs.writeFileSync(TRUSTED_CLOCK_PATH, JSON.stringify({ wall }), 'utf8') } catch (_) {}
}
/**
 * Vérifie que l'horloge n'a pas reculé depuis la dernière référence de confiance.
 * Si un recul > tolérance est détecté, on journalise et on marque `clockTampered`
 * (le mode hors ligne devient plus strict : on exige une reconnexion).
 */
function checkClockIntegrity() {
  const now = Date.now()
  const rec = readTrustedClock()
  if (cp.detectClockRollback(rec?.wall ?? null, now, CLOCK_SKEW_MS)) {
    if (!clockTampered) log('SECURITY: clock rollback detected — offline mode restricted')
    clockTampered = true
    reportCrash({ message: 'clock_rollback_detected', fatal: false, kind: 'security' }).catch(() => {})
    return false
  }
  // Avance normale de l'horloge → on met à jour la référence (monotone croissante).
  if (!rec || now > rec.wall) writeTrustedClock(now)
  return true
}

// ── Crash reporting (offline-first, consentement requis) ──────────────────────
function readCrashQueue() {
  try { const q = JSON.parse(fs.readFileSync(CRASH_QUEUE_PATH, 'utf8')); return Array.isArray(q) ? q : [] } catch { return [] }
}
function writeCrashQueue(list) {
  try { fs.writeFileSync(CRASH_QUEUE_PATH, JSON.stringify(list), 'utf8') } catch (_) {}
}
function pushBreadcrumb(action) {
  breadcrumbs = cp.pushBounded(breadcrumbs, { t: Date.now(), a: String(action).slice(0, 120) }, 25)
}

/** Construit et met en file un rapport de crash, puis tente de le vider. */
async function reportCrash({ message, stack, fatal = true, kind = 'crash' }) {
  if (!crashConsent()) return
  try {
    const info = getSystemInfo()
    const logsTail = (() => { try { return fs.readFileSync(LOG_PATH, 'utf8').slice(-4000) } catch { return null } })()
    const payload = {
      consent:     true,
      licenseId:   activeLicense?.payload?.lid ?? null,
      hwid:        getHwid(),
      appVersion:  info.version,
      channel:     UPDATE_CHANNEL,
      os:          info.os,
      arch:        info.arch,
      cpu:         info.cpu,
      ramMb:       info.ramMb,
      message:     String(message || 'unknown').slice(0, 2000),
      stack:       stack ? String(stack).slice(0, 20000) : null,
      breadcrumbs: JSON.stringify(breadcrumbs).slice(0, 10000),
      logs:        logsTail,
      fatal:       !!fatal,
      kind,
    }
    const queue = cp.pushBounded(readCrashQueue(), payload, 50)
    writeCrashQueue(queue)
    log(`[crash] queued (${kind}) — ${payload.message.slice(0, 80)}`)
    await flushCrashQueue()
  } catch (err) {
    try { log('reportCrash error:', err.message) } catch (_) {}
  }
}

/** Vide la file de crash vers le serveur (best-effort ; garde ce qui échoue). */
async function flushCrashQueue() {
  const base = cp.resolveRemoteBase(process.env)
  if (!base) return
  let queue = readCrashQueue()
  if (queue.length === 0) return
  const remaining = []
  for (const item of queue) {
    const res = await httpPost(`${base}/api/crash`, item).catch(() => null)
    if (!(res && res.ok)) remaining.push(item)   // échec → on réessaiera plus tard
  }
  writeCrashQueue(remaining)
  if (queue.length !== remaining.length) log(`[crash] flushed ${queue.length - remaining.length} report(s)`)
}

// ── Notifications (récupération + diffusion au renderer) ──────────────────────
async function fetchNotifications() {
  const base = cp.resolveRemoteBase(process.env)
  const lid  = activeLicense?.payload?.lid
  if (!base || !lid) return
  const url = `${base}/api/notifications?licenseId=${encodeURIComponent(lid)}`
          + `&version=${encodeURIComponent(app.getVersion())}&channel=${encodeURIComponent(UPDATE_CHANNEL)}`
  const res = await httpGetJson(url).catch(() => null)
  if (res && Array.isArray(res.notifications)) {
    currentNotifs = res.notifications
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notifications:update', { notifications: currentNotifs })
    }
  }
}

/** Register global crash handlers (main process). Never crashes the reporter. */
function registerCrashHandlers() {
  process.on('uncaughtException', (err) => {
    try { log('[uncaughtException]', err?.message) } catch (_) {}
    reportCrash({ message: err?.message || 'uncaughtException', stack: err?.stack, fatal: true }).catch(() => {})
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    reportCrash({ message: err.message || 'unhandledRejection', stack: err.stack, fatal: false }).catch(() => {})
  })
}

/**
 * Check stored license: decrypt → verify ECC → HWID tolerance check.
 * Returns the payload if still valid, null otherwise.
 */
function checkStoredLicense() {
  const stored = loadLicense()
  if (!stored?.token) return null

  const payload = verifyEccToken(stored.token)
  if (!payload) return null

  // Optional HWID binding (from token payload)
  if (payload.hwid) {
    const currentHwid = getHwid()
    if (!hwidMatches(payload.hwid, currentHwid)) {
      log('HWID mismatch — token requires:', payload.hwid, 'current:', currentHwid)
      return null
    }
  }

  return payload
}

// ── Inject license cookies into Electron session ──────────────────────────────
// The Next.js middleware (src/middleware.ts) checks for a signed HS256 JWT in
// the "gf_session" cookie.  Electron must mint that token itself so that every
// page request is allowed through the middleware gate.

function createGfSessionJwt(typ, lid) {
  const secret  = process.env.NEXTAUTH_SECRET ?? 'gf-electron-local-secret-2026-xK9mP3qR'
  const now     = Math.floor(Date.now() / 1000)
  const exp     = now + 5 * 365 * 24 * 3600   // 5 years

  // Standard HS256 JWT — compatible with jose's jwtVerify()
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ typ, lid, iat: now, exp })).toString('base64url')
  const sig     = crypto.createHmac('sha256', secret)
                        .update(`${header}.${payload}`)
                        .digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function injectLicenseCookies(licenseType, licenseId = 'electron-local') {
  const baseUrl = `http://127.0.0.1:${PORT}`
  const expDate = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600
  const jwt     = createGfSessionJwt(licenseType, licenseId)

  // Primary cookie — verified by middleware
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_session',
    value:          jwt,
    path:           '/',
    expirationDate: expDate,
    sameSite:       'lax',
  })

  // Legacy cookies kept for any code still reading them
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_license_validated',
    value:          '1',
    path:           '/',
    expirationDate: expDate,
    sameSite:       'lax',
  })
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_license_type',
    value:          licenseType,
    path:           '/',
    expirationDate: expDate,
    sameSite:       'lax',
  })

  log(`Session cookies injected — type: ${licenseType}`)
}

// ── Database setup ────────────────────────────────────────────────────────────

// Returns true only if the file at dbPath is a valid SQLite database.
// Compares the first 15 bytes as hex to avoid any null-byte string handling
// differences on Windows. SQLite magic: "SQLite format 3" + 0x00.
// S=53 Q=51 L=4c i=69 t=74 e=65 sp=20 f=66 o=6f r=72 m=6d a=61 t=74 sp=20 3=33
const SQLITE_MAGIC_HEX = '53514c69746520666f726d61742033'

function isDbValid(dbPath) {
  try {
    const stat = fs.statSync(dbPath)
    if (stat.size < 512) {
      log('isDbValid: too small:', stat.size, 'bytes --', dbPath)
      return false
    }
    const buf = Buffer.alloc(15)
    const fd  = fs.openSync(dbPath, 'r')
    fs.readSync(fd, buf, 0, 15, 0)
    fs.closeSync(fd)
    const hex = buf.toString('hex')
    const ok  = (hex === SQLITE_MAGIC_HEX)
    if (!ok) log('isDbValid: bad header hex:', hex, '-- expected:', SQLITE_MAGIC_HEX, '-- file:', dbPath)
    return ok
  } catch (err) {
    log('isDbValid error:', err.message, '--', dbPath)
    return false
  }
}

function setupDatabase() {
  fs.mkdirSync(APP_DATA, { recursive: true })
  fs.mkdirSync(PHOTOS_DIR, { recursive: true })  // ensure photos dir exists

  const needsInit = !fs.existsSync(DB_PATH) || !isDbValid(DB_PATH)

  if (needsInit) {
    if (fs.existsSync(DB_PATH)) {
      // Back up the corrupt/empty file before overwriting so we never silently lose data
      const badPath = DB_PATH + '.bad-' + Date.now()
      try { fs.renameSync(DB_PATH, badPath) } catch (_) {}
      log('WARNING: Existing database was empty or corrupt — moved to', badPath)
    }

    // Find the bundled empty database (template with schema applied)
    const rp = process.resourcesPath ?? ''
    log('Looking for DB template — resourcesPath:', rp, '| ROOT:', ROOT)
    const candidates = [
      // post-build.js always copies the template as garageflow-template.db
      path.join(rp, 'prisma',             'garageflow-template.db'),
      path.join(rp, 'standalone', 'prisma', 'garageflow-template.db'),
      // Legacy names kept as fallback
      path.join(rp, 'prisma',             'garageflow.db'),
      path.join(rp, 'prisma',             'dev.db'),
      path.join(rp, 'standalone', 'prisma', 'garageflow.db'),
      path.join(rp, 'standalone', 'prisma', 'dev.db'),
      path.join(ROOT, 'prisma',           'garageflow-template.db'),
      path.join(ROOT, 'prisma',           'garageflow.db'),
      path.join(ROOT, 'prisma',           'dev.db'),
    ]
    for (const c of candidates) {
      const exists = fs.existsSync(c)
      const valid  = exists && isDbValid(c)
      log('  candidate:', c, '— exists:', exists, '| valid:', valid)
    }
    const src = candidates.find(p => fs.existsSync(p) && isDbValid(p))
    if (src) {
      fs.copyFileSync(src, DB_PATH)
      log('Database initialised from template:', src)
    } else {
      log('FATAL: No database template found in resources — installation may be corrupted')
      dialog.showErrorBox(
        'GarageFlow — Base de données manquante',
        'Le fichier de base de données n\'a pas été trouvé dans les ressources de l\'application.\n\n' +
        'resourcesPath: ' + rp + '\n\n' +
        'Consultez le fichier log pour plus de détails :\n' + LOG_PATH + '\n\n' +
        'Solution : désinstallez GarageFlow puis réinstallez-le depuis le fichier d\'installation fourni.'
      )
      app.quit()
      process.exit(1)
    }
  } else {
    log('Existing database:', DB_PATH)
  }

}

// ── Periodic license revocation check (adaptive: 2 min active / 20 s blocked) ─
// Checks the LOCAL Next.js API first, then an optional REMOTE license server
// (GF_LICENSE_SERVER env var, e.g. https://admin.garageflow.example.com).
// Fail-open on ALL network errors so offline use continues working.
//
// Behaviour when the status changes:
//   • revoked / suspended / tampered → the app STAYS OPEN and the renderer shows
//     a persistent blocking overlay (no auto-quit). The customer sees exactly why
//     access is blocked and keeps their unsaved work.
//   • reactivated (status back to "active") → the renderer is told to lift the
//     overlay so the user resumes right where they left off.

const LICENSE_CHECK_INTERVAL_MS = 2 * 60 * 1_000   // normal cadence: every 2 minutes
const LICENSE_CHECK_BLOCKED_MS  = 20 * 1_000       // faster cadence while blocked → reactivation shows up quickly

// Make an HTTP/HTTPS POST request, returns parsed JSON or null
function httpPost(url, body) {
  return new Promise((resolve) => {
    try {
      const bodyStr = JSON.stringify(body)
      const parsed  = new URL(url)
      const mod     = parsed.protocol === 'https:' ? require('https') : http
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path:     parsed.pathname + parsed.search,
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
          timeout:  10_000,
        },
        res => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end',  ()    => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
        }
      )
      req.on('error',   () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
      req.write(bodyStr)
      req.end()
    } catch { resolve(null) }
  })
}

// Make an HTTP/HTTPS GET request, returns parsed JSON or null (fail-open).
function httpGetJson(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url)
      const mod    = parsed.protocol === 'https:' ? require('https') : http
      const req = mod.get(
        {
          hostname: parsed.hostname,
          port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path:     parsed.pathname + parsed.search,
          timeout:  10_000,
        },
        res => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end',  ()    => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
        }
      )
      req.on('error',   () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    } catch { resolve(null) }
  })
}

async function periodicLicenseCheck() {
  if (!activeLicense?.payload?.lid) return

  const licenseId = activeLicense.payload.lid
  let result = null

  // Télémétrie technique jointe au heartbeat (jamais de donnée métier).
  const info = getSystemInfo()
  const body = { licenseId, version: info.version, os: info.os, arch: info.arch, hwid: getHwid() }

  // 1. Check remote license server (if configured) — authoritative
  const remoteServer = process.env.GF_LICENSE_SERVER
  if (remoteServer) {
    try {
      result = await httpPost(`${remoteServer.replace(/\/$/, '')}/api/license/check`, body)
      if (result) log('[license/check] remote result:', JSON.stringify(result))
    } catch (err) {
      log('[license/check] remote server unreachable (fail-open):', err.message)
    }
  }

  // 2. Fall back to local check
  if (!result) {
    try {
      result = await httpPost(`http://127.0.0.1:${PORT}/api/license/check`, body)
      if (result) log('[license/check] local result:', JSON.stringify(result))
    } catch (err) {
      log('[license/check] local check error (fail-open):', err.message)
    }
  }

  // No response at all (remote + local both unreachable) → indeterminate.
  // Fail-open: keep the current state, never lock a legitimate user out offline.
  if (!result) return

  if (result.allowed === false) {
    // ── Blocked: revoked / suspended / tampered ──────────────────────────────
    // Do NOT quit. Keep the app open and tell the renderer to show a persistent
    // blocking overlay, so the customer sees why access is blocked and can pick
    // up instantly (without losing unsaved work) the moment it is reactivated.
    const status = result.status ?? 'revoked'
    const reason = result.reason ?? 'Licence révoquée ou suspendue.'
    if (!licenseBlocked) log('SECURITY: access blocked —', status, '—', reason)
    licenseBlocked = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Re-sent on every blocked check so the overlay reappears even after an
      // accidental page reload.
      mainWindow.webContents.send('license:revoked', { reason, status })
    }
  } else if (result.status === 'active') {
    // ── Confirmed active ─────────────────────────────────────────────────────
    // Only treat as a reactivation on an explicit "active" status (never on the
    // fail-open "unknown" status) and only when we were previously blocked.
    if (licenseBlocked) {
      licenseBlocked = false
      log('License reactivated — lid:', licenseId)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license:reactivated', { status: 'active' })
      }
    }
  }
  // status 'unknown' (record not yet registered / DB fail-open) → keep current state.

  // ── Modules / droits (entitlements) — le serveur est la source de vérité ────
  if (Array.isArray(result.modules)) {
    const next = result.modules.slice().sort()
    if (JSON.stringify(next) !== JSON.stringify(currentModules)) {
      currentModules = next
      saveEntitlements(currentModules)
      broadcastEntitlements()
      log('[entitlements] modules updated:', currentModules.join(', ') || '(none)')
    }
  }

  // ── Notifications + envoi différé des crashs (best-effort) ─────────────────
  fetchNotifications().catch(() => {})
  flushCrashQueue().catch(() => {})
}

function startPeriodicLicenseCheck() {
  if (licenseCheckStarted) return
  licenseCheckStarted = true
  // First check after 30s (give the server time to settle), then re-arm adaptively.
  setTimeout(() => {
    periodicLicenseCheck().catch(() => {}).finally(scheduleNextLicenseCheck)
  }, 30_000)
}

// Re-arm the next license check. Polls faster while access is blocked so a
// reactivation is reflected quickly; returns to the normal cadence once active.
function scheduleNextLicenseCheck() {
  if (licenseTimer) { clearTimeout(licenseTimer); licenseTimer = null }
  const delay = licenseBlocked ? LICENSE_CHECK_BLOCKED_MS : LICENSE_CHECK_INTERVAL_MS
  licenseTimer = setTimeout(() => {
    periodicLicenseCheck().catch(() => {}).finally(scheduleNextLicenseCheck)
  }, delay)
}

// ── Internet connectivity / 48h grace period ──────────────────────────────────

function readLastOnline() {
  try {
    const raw = fs.readFileSync(ONLINE_CHECK_FILE(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveLastOnline() {
  try {
    fs.writeFileSync(ONLINE_CHECK_FILE(), JSON.stringify({ ts: Date.now() }), 'utf8')
  } catch (_) {}
}

async function checkInternetConnectivity() {
  return new Promise(resolve => {
    const req = require('https').get(ONLINE_CHECK_URL, { timeout: 8_000 }, res => {
      resolve(true)
      res.destroy()
    })
    req.on('error',   () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function enforceOnlineGracePeriod() {
  const online = await checkInternetConnectivity()
  if (online) {
    saveLastOnline()
    // Une reconnexion rétablit la confiance sur l'horloge (nouvelle référence).
    clockTampered = false
    writeTrustedClock(Date.now())
    log('[online-check] connected — last_online updated')
    // Notify UI of online status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:online-status', { online: true })
    }
    return
  }

  log('[online-check] offline — checking grace period')
  // Anti-contournement : détecte un recul de l'horloge Windows.
  checkClockIntegrity()
  const rec = readLastOnline()
  const lastOnlineTs = rec?.ts ?? 0
  const offlineMs = Date.now() - lastOnlineTs

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:online-status', { online: false, offlineMs })
  }

  // Verrouillage si : hors ligne trop longtemps OU horloge incohérente (recul
  // détecté / durée hors ligne négative) — impossible de gagner du temps en
  // reculant la date Windows.
  if (offlineMs > LOCK_PERIOD_MS || offlineMs < 0 || clockTampered) {
    const why = clockTampered || offlineMs < 0
      ? 'Incohérence de l\'horloge système détectée.'
      : 'Votre logiciel est hors ligne depuis plus de 72 heures.'
    log('[online-check] locking app —', clockTampered || offlineMs < 0 ? 'clock tamper' : 'offline > 72h')
    const { dialog: d } = require('electron')
    await d.showMessageBox(mainWindow ?? { webContents: null }, {
      type:    'error',
      title:   'GarageFlow — Connexion requise',
      message: 'GarageFlow nécessite une connexion internet.',
      detail:  `${why}\nVeuillez connecter ce PC à internet pour continuer à utiliser GarageFlow.`,
      buttons: ['Fermer'],
    }).catch(() => {})
    app.quit()
  } else if (offlineMs > GRACE_PERIOD_MS) {
    const remaining = Math.ceil((LOCK_PERIOD_MS - offlineMs) / (60 * 60 * 1_000))
    log(`[online-check] offline > 48h — warning (${remaining}h remaining)`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      require('electron').dialog.showMessageBox(mainWindow, {
        type:    'warning',
        title:   'GarageFlow — Mode hors ligne',
        message: `GarageFlow est hors ligne depuis plus de 48 heures.`,
        detail:  `Connectez ce PC à internet dans les ${remaining} heure(s) pour éviter le verrouillage du logiciel.`,
        buttons: ['OK'],
      }).catch(() => {})
    }
  }
}

function startOnlineGraceCheck() {
  if (onlineCheckTimer) return
  // First check after 30s (let the app settle), then every 4h
  setTimeout(() => {
    enforceOnlineGracePeriod()
    onlineCheckTimer = setInterval(enforceOnlineGracePeriod, 4 * 60 * 60 * 1_000)
  }, 30_000)
}

// ── Auto-backup (3-tier: hourly × 24, daily × 7, weekly × 4) ─────────────────
//
// Tier 1 — Hourly : every run, file = hourly/garageflow_YYYYMMDD_HH.db
// Tier 2 — Daily  : once per day  (first hourly of a new day), file = daily/garageflow_YYYYMMDD.db
// Tier 3 — Weekly : once per week (first daily of a new ISO-week), file = weekly/garageflow_YYYY-WWW.db

function pruneDir(dir, prefix, keep) {
  try {
    const all = fs.readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.db'))
      .sort()
    all.slice(0, Math.max(0, all.length - keep)).forEach(f => {
      try { fs.unlinkSync(path.join(dir, f)) } catch (_) {}
    })
  } catch (_) {}
}

function isoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  return [tmp.getUTCFullYear(), Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7)]
}

function runBackup() {
  if (!fs.existsSync(DB_PATH)) return
  try {
    const d    = new Date()
    const yyyy = d.getFullYear()
    const mm   = String(d.getMonth() + 1).padStart(2, '0')
    const dd   = String(d.getDate()).padStart(2, '0')
    const HH   = String(d.getHours()).padStart(2, '0')

    // ── Hourly ──────────────────────────────────────────────────────────────
    fs.mkdirSync(BAK_HOURLY, { recursive: true })
    const hourlyFile = path.join(BAK_HOURLY, `garageflow_${yyyy}${mm}${dd}_${HH}.db`)
    fs.copyFileSync(DB_PATH, hourlyFile)
    pruneDir(BAK_HOURLY, 'garageflow_', 24)
    log('Backup hourly:', hourlyFile)

    // ── Daily (once per calendar day) ───────────────────────────────────────
    fs.mkdirSync(BAK_DAILY, { recursive: true })
    const dailyFile = path.join(BAK_DAILY, `garageflow_${yyyy}${mm}${dd}.db`)
    if (!fs.existsSync(dailyFile)) {
      fs.copyFileSync(DB_PATH, dailyFile)
      pruneDir(BAK_DAILY, 'garageflow_', 7)
      log('Backup daily:', dailyFile)

      // ── Weekly (once per ISO week, triggered by first daily of the week) ──
      fs.mkdirSync(BAK_WEEKLY, { recursive: true })
      const [wyear, wnum] = isoWeek(d)
      const weeklyFile    = path.join(BAK_WEEKLY, `garageflow_${wyear}-W${String(wnum).padStart(2,'0')}.db`)
      if (!fs.existsSync(weeklyFile)) {
        fs.copyFileSync(DB_PATH, weeklyFile)
        pruneDir(BAK_WEEKLY, 'garageflow_', 4)
        log('Backup weekly:', weeklyFile)
      }
    }
  } catch (err) { log('Backup error:', err.message) }
}

// ── Next.js standalone server ─────────────────────────────────────────────────

function resolveServerPaths() {
  if (IS_DEV) {
    return {
      serverJs: path.join(ROOT, '.next', 'standalone', 'server.js'),
      cwd:      path.join(ROOT, '.next', 'standalone'),
    }
  }
  // In production, extraResources puts standalone at resources/standalone/
  return {
    serverJs: path.join(process.resourcesPath, 'standalone', 'server.js'),
    cwd:      path.join(process.resourcesPath, 'standalone'),
  }
}

function waitForServer(timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = setInterval(() => {
      http.get(`http://127.0.0.1:${PORT}/`, res => {
        clearInterval(check)
        resolve(res.statusCode)
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(check)
          reject(new Error(`Server did not respond within ${timeoutMs / 1000}s`))
        }
      })
    }, 400)
  })
}

// ── Desktop CSV Export (20h quotidien) ───────────────────────────────────────

function toCsv(rows, headers) {
  const escape = v => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))
  return lines.join('\r\n')
}

async function runInternalMigration() {
  const body = JSON.stringify({})
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: '/api/internal/migrate', method: 'POST' },
      res => {
        let raw = ''
        res.on('data', d => (raw += d))
        res.on('end', () => {
          log('DB migration result:', raw.slice(0, 120))
          resolve(raw)
        })
      }
    )
    req.on('error', reject)
    req.setHeader('Content-Type', 'application/json')
    req.setHeader('Content-Length', Buffer.byteLength(body))
    req.setHeader('x-internal-key', INTERNAL_EXPORT_KEY)
    req.write(body)
    req.end()
  })
}

async function runDesktopExport() {
  log('Desktop export: starting…')
  try {
    const desktop = app.getPath('desktop')
    const d       = new Date()
    const stamp   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const dir     = path.join(desktop, `GarageFlow_Export_${stamp}`)
    fs.mkdirSync(dir, { recursive: true })

    // Fetch all data from the internal API
    const res  = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: PORT, path: '/api/internal/export', method: 'GET',
          headers: { 'x-internal-key': INTERNAL_EXPORT_KEY } },
        r => {
          let body = ''
          r.on('data', c => body += c)
          r.on('end', () => resolve({ status: r.statusCode, body }))
        }
      )
      req.on('error', reject)
      req.end()
    })

    if (res.status !== 200) {
      log('Desktop export: API error', res.status, res.body)
      return
    }

    const data = JSON.parse(res.body)

    // ── Clients ──
    if (data.clients?.length) {
      fs.writeFileSync(
        path.join(dir, '01_Clients.csv'),
        toCsv(data.clients, ['id','name','phone','email','address','createdAt']),
        'utf8'
      )
    }

    // ── Véhicules ──
    if (data.vehicles?.length) {
      const rows = data.vehicles.map(v => ({
        ...v,
        clientName: v.client?.name ?? '',
      }))
      fs.writeFileSync(
        path.join(dir, '02_Vehicules.csv'),
        toCsv(rows, ['licensePlate','make','model','year','mileage','color','vin','clientName','createdAt']),
        'utf8'
      )
    }

    // ── Interventions ──
    if (data.jobs?.length) {
      const rows = data.jobs.map(j => ({
        ...j,
        mechanicName: j.mechanic?.name ?? '',
        parts: j.jobParts?.map(p => p.part?.name).filter(Boolean).join(' | ') ?? '',
      }))
      fs.writeFileSync(
        path.join(dir, '03_Interventions.csv'),
        toCsv(rows, ['date','startTime','customerName','vehicleModel','licensePlate','repairType','status','estimatedDuration','mechanicName','isUrgent','notes','parts']),
        'utf8'
      )
    }

    // ── Factures ──
    if (data.invoices?.length) {
      const rows = data.invoices.map(inv => {
        const totalHT = inv.lines?.reduce((s, l) => s + l.quantity * l.unitPrice, 0) ?? 0
        const totalTTC = totalHT * (1 + (inv.taxRate ?? 20) / 100)
        return {
          ...inv,
          totalHT:  totalHT.toFixed(2),
          totalTTC: totalTTC.toFixed(2),
        }
      })
      fs.writeFileSync(
        path.join(dir, '04_Factures.csv'),
        toCsv(rows, ['number','issueDate','dueDate','clientName','clientEmail','clientPhone','vehicleModel','licensePlate','status','totalHT','totalTTC','taxRate','notes']),
        'utf8'
      )
    }

    // ── Devis ──
    if (data.quotes?.length) {
      const rows = data.quotes.map(q => {
        const totalHT = q.lines?.reduce((s, l) => s + l.quantity * l.unitPrice, 0) ?? 0
        const totalTTC = totalHT * (1 + (q.taxRate ?? 20) / 100)
        return { ...q, totalHT: totalHT.toFixed(2), totalTTC: totalTTC.toFixed(2) }
      })
      fs.writeFileSync(
        path.join(dir, '05_Devis.csv'),
        toCsv(rows, ['number','issueDate','validUntil','clientName','clientEmail','vehicleModel','licensePlate','status','totalHT','totalTTC','taxRate','notes']),
        'utf8'
      )
    }

    // ── Stock pièces ──
    if (data.parts?.length) {
      fs.writeFileSync(
        path.join(dir, '06_Stock_Pieces.csv'),
        toCsv(data.parts, ['reference','name','description','quantity','minQuantity','unitCost','unitPrice','location']),
        'utf8'
      )
    }

    // ── Mécaniciens ──
    if (data.mechanics?.length) {
      fs.writeFileSync(
        path.join(dir, '07_Mecaniciens.csv'),
        toCsv(data.mechanics, ['name','specialty','isAbsent']),
        'utf8'
      )
    }

    // ── Rappels ──
    if (data.reminders?.length) {
      fs.writeFileSync(
        path.join(dir, '08_Rappels.csv'),
        toCsv(data.reminders, ['scheduledDate','clientName','vehicleModel','licensePlate','phone','email','type','status','notes']),
        'utf8'
      )
    }

    log('Desktop export: done →', dir)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:desktop-export-done', { dir, stamp })
    }
  } catch (err) {
    log('Desktop export error:', err.message)
  }
}

function scheduleDailyDesktopExport() {
  function msUntil20h() {
    const now  = new Date()
    const next = new Date(now)
    next.setHours(20, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next - now
  }

  function arm() {
    const delay = msUntil20h()
    log(`Desktop export scheduled in ${Math.round(delay / 60000)} min`)
    desktopExportTimer = setTimeout(async () => {
      try { await runDesktopExport() } catch (err) { log('Desktop export error:', err.message) }
      arm()   // re-schedule for next day regardless of errors
    }, delay)
  }

  arm()
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const { serverJs, cwd } = resolveServerPaths()

    if (!fs.existsSync(serverJs)) {
      if (IS_DEV) {
        log('Dev: assuming Next.js dev server is running separately on port', PORT)
        resolve()
        return
      }
      reject(new Error(`server.js not found:\n${serverJs}\n\nRun: npm run build`))
      return
    }

    log('Starting Next.js server on port', PORT)

    // Windows-safe path: use forward slashes in DATABASE_URL
    const dbUrl = `file:${DB_PATH.replace(/\\/g, '/')}`

    const env = {
      ...process.env,
      PORT:              String(PORT),
      HOSTNAME:          '0.0.0.0',
      NEXTAUTH_URL:      `http://127.0.0.1:${PORT}`,
      DATABASE_URL:      dbUrl,
      // Use whatever secret the main process has loaded (from .env or fallback),
      // so JWTs minted by main.js and verified by Next.js always share the same secret.
      NEXTAUTH_SECRET:   process.env.NEXTAUTH_SECRET ?? 'gf-electron-local-secret-2026-xK9mP3qR',
      GF_DB_MAC_SECRET:         deriveDbMacSecret(),
      GF_INTERNAL_EXPORT_KEY:   INTERNAL_EXPORT_KEY,
      GF_PHOTOS_DIR:            PHOTOS_DIR,
      ELECTRON:                 '1',
      NODE_ENV:                 'production',
    }

    // utilityProcess.fork() runs server.js in a real Node.js utility process.
    // spawn(process.execPath, [serverJs]) would start another Electron instance
    // instead, so we must use utilityProcess here (available since Electron 22).
    nextServer = utilityProcess.fork(serverJs, [], {
      cwd,
      env,
      stdio: 'pipe',
      serviceName: 'GarageFlow-server',
    })

    if (nextServer.stdout) {
      nextServer.stdout.on('data', d => log('[next]', d.toString().trimEnd()))
    }
    if (nextServer.stderr) {
      nextServer.stderr.on('data', d => {
        const msg = d.toString().trimEnd()
        log('[next:err]', msg)
        if (msg.includes('DATABASE_URL') || msg.includes('PrismaClientInitializationError')) {
          log('FATAL: Prisma cannot connect — check DATABASE_URL and run: npx prisma db push')
        }
      })
    }
    nextServer.on('exit', code => {
      log(`Next.js exited — code=${code}`)
      nextServer = null
    })

    waitForServer(35_000)
      .then(() => { log('Next.js server ready'); resolve() })
      .catch(err  => { log('Server timeout:', err.message); resolve() })  // fail-open
  })
}

// ── Windows ───────────────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width:           520,
    height:          320,
    frame:           false,
    transparent:     false,
    resizable:       false,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    center:          true,
    backgroundColor: '#0f1629',
    webPreferences:  { contextIsolation: true, nodeIntegration: false },
  })
  // __dirname works in both dev and inside the ASAR (Electron handles ASAR paths)
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.on('closed', () => { splashWindow = null })
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
    splashWindow = null
  }
}

// ── License window ────────────────────────────────────────────────────────────
// Shows a native window to enter the GF2 token BEFORE the server starts.
// IPC: renderer sends 'license-submit' with the token string.

function createLicenseWindow() {
  return new Promise(resolve => {
    const win = new BrowserWindow({
      width:           620,
      height:          540,
      frame:           false,
      resizable:       false,
      center:          true,
      alwaysOnTop:     true,
      backgroundColor: '#0f1629',
      webPreferences: {
        preload:          path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
      },
    })

    win.loadFile(path.join(__dirname, 'license.html'))

    function cleanup() {
      ipcMain.removeAllListeners('license-submit')
      ipcMain.removeAllListeners('license-quit')
    }

    ipcMain.on('license-submit', (event, token) => {
      const payload = verifyEccToken(token)
      if (payload) {
        saveLicense(token, payload)
        activeLicense = { token, payload }
        cleanup()
        win.destroy()
        resolve(true)
      } else {
        // Provide a human-readable reason
        const nowSec = Math.floor(Date.now() / 1000)
        let reason = 'Licence invalide ou modifiée'
        try {
          const parts = token.trim().split('.')
          if (parts.length === 4) {
            const p = JSON.parse(Buffer.from(parts[2] + '==', 'base64url').toString('utf8'))
            if (p.exp && p.exp < nowSec) {
              reason = `Licence expirée le ${new Date(p.exp * 1000).toLocaleDateString('fr-FR')}`
            }
          }
        } catch (_) {}
        event.sender.send('license-error', reason)
      }
    })

    ipcMain.on('license-quit', () => {
      cleanup()
      win.destroy()
      resolve(false)
    })

    win.on('closed', () => { cleanup(); resolve(false) })
  })
}

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  const iconPath = IS_DEV
    ? path.join(ROOT, 'icon.ico')
    : path.join(process.resourcesPath, 'icon.ico')

  const iconExists = fs.existsSync(iconPath)
  if (iconExists) {
    try { app.setIcon(iconPath) } catch (_) {}
  }

  mainWindow = new BrowserWindow({
    width:           1440,
    height:          900,
    minWidth:        1024,
    minHeight:       700,
    show:            false,
    backgroundColor: '#070d1b',
    icon:            iconExists ? iconPath : undefined,
    title:           'GarageFlow',
    frame:           false,
    titleBarStyle:   'hidden',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      spellcheck:       false,
    },
  })

  Menu.setApplicationMenu(null)

  // Block DevTools in production
  if (!IS_DEV) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools()
    })
  }

  // Capture les crashs du process de rendu (page blanche / OOM du renderer).
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    reportCrash({ message: `render-process-gone: ${details?.reason || 'unknown'}`, fatal: true, kind: 'renderer' }).catch(() => {})
  })

  const APP_URL = `http://127.0.0.1:${PORT}`

  // The standalone Next.js server + Prisma engine can take a while to accept
  // connections on a cold start (especially on Windows / first run while the
  // database is being provisioned). Instead of failing straight to a bare
  // ERR_CONNECTION_REFUSED, keep retrying the load for ~30 s before giving up.
  const MAX_LOAD_RETRIES = 25
  let loadRetries = 0
  let retryTimer = null

  function loadApp() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.loadURL(APP_URL)
  }

  function showLoadError(code, desc, url) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#070d1b;color:#94a3b8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px">
<div style="font-size:48px">⚠</div>
<p style="color:#f87171;font-size:16px;font-weight:700">Impossible de charger GarageFlow</p>
<p style="font-size:12px">Erreur ${code}: ${desc}</p>
<p style="font-size:11px;color:#475569">URL: ${url}</p>
<p style="font-size:11px;color:#475569">Log: ${LOG_PATH}</p>
<button onclick="location.href='${APP_URL}'" style="margin-top:16px;padding:8px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:13px">Réessayer</button>
</body></html>`
    mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    closeSplash()
    mainWindow.show()
  }

  loadApp()

  mainWindow.on('maximize',          () => mainWindow.webContents.send('win:maximized-change', true))
  mainWindow.on('unmaximize',        () => mainWindow.webContents.send('win:maximized-change', false))
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('win:fullscreen-change', true))
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('win:fullscreen-change', false))

  // Log renderer-side console errors to our log file
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('[renderer:error]', message)
  })

  // A successful load means the server is up — reset the retry budget so any
  // later runtime navigation failure gets a fresh set of retries.
  mainWindow.webContents.on('did-finish-load', () => { loadRetries = 0 })

  // Auto-retry on failure (server still warming up), then show a diagnostic page.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 (ERR_ABORTED) fires for sub-resources and cancelled navigations — ignore.
    if (!isMainFrame || code === -3) return
    log('did-fail-load:', code, desc, url, '(attempt', loadRetries + 1, 'of', MAX_LOAD_RETRIES, ')')
    // Only auto-retry the real app URL, not the data: error page.
    if (url && url.startsWith(APP_URL) && loadRetries < MAX_LOAD_RETRIES) {
      loadRetries++
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(loadApp, 1200)
      return
    }
    showLoadError(code, desc, url)
  })

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    mainWindow.show()
    mainWindow.maximize()
    log('Main window shown')
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // Verify license immediately when the user brings the window back to focus
  mainWindow.on('focus', () => {
    if (!IS_DEV) periodicLicenseCheck()
  })
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('app:version',      () => app.getVersion())
  ipcMain.handle('app:db-path',      () => DB_PATH)
  ipcMain.handle('app:open-backups', () => { fs.mkdirSync(BAK_HOURLY, { recursive: true }); shell.openPath(BAK_DIR) })
  ipcMain.handle('app:open-logs',    () => shell.openPath(LOG_PATH))

  ipcMain.handle('app:backup', () => {
    runBackup()
    return { success: true, dir: BAK_DIR }
  })

  ipcMain.handle('win:minimize',          () => mainWindow?.minimize())
  ipcMain.handle('win:maximize-toggle',   () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('win:close',             () => mainWindow?.close())
  ipcMain.handle('win:fullscreen-toggle', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  ipcMain.handle('win:is-maximized',      () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('app:license-info', () => {
    if (!activeLicense) return null
    const { payload } = activeLicense
    return {
      licenseId:   payload.lid,
      customerId:  payload.cid,
      licenseType: payload.typ,
      expiryAt:    new Date(payload.exp * 1000).toISOString(),
      seats:       payload.seats,
      isAdmin:     payload.typ === 'admin',
    }
  })

  // Manual desktop export trigger from the UI
  ipcMain.handle('app:desktop-export-now', async () => {
    await runDesktopExport()
    return { ok: true }
  })

  ipcMain.handle('app:open-desktop-export', () => {
    const desktop = app.getPath('desktop')
    shell.openPath(desktop)
  })

  // Update check — checks admin license server first, then GitHub releases
  ipcMain.handle('app:check-updates', async () => {
    try {
      const currentVersion = app.getVersion()

      // 1. Check admin-published update (via GF_LICENSE_SERVER or local file)
      const remoteServer = process.env.GF_LICENSE_SERVER
      if (remoteServer) {
        const adminUpdate = await new Promise(resolve => {
          const mod = remoteServer.startsWith('https') ? require('https') : http
          mod.get(`${remoteServer.replace(/\/$/, '')}/api/admin/updates`, { timeout: 5000 }, res => {
            let raw = ''
            res.on('data', c => raw += c)
            res.on('end',  () => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
          }).on('error', () => resolve(null)).on('timeout', () => resolve(null))
        }).catch(() => null)
        if (adminUpdate?.hasUpdate && adminUpdate.latestVersion) {
          const hasUpdate = adminUpdate.latestVersion !== currentVersion
          if (hasUpdate) return {
            hasUpdate:     true,
            latestVersion: adminUpdate.latestVersion,
            // Fichier .exe téléversé par l'admin → URL directe téléchargeable in-app
            releaseUrl:    adminUpdate.downloadPath
              ? `${remoteServer.replace(/\/$/, '')}${adminUpdate.downloadPath}`
              : (adminUpdate.releaseUrl ?? null),
            releaseNotes:  adminUpdate.releaseNotes ?? null,
            source:        'admin',
          }
        }
      }

      // 2. Check local admin file
      const localUpdateFile = path.join(APP_DATA, 'gf_update.json')
      try {
        const localUpdate = JSON.parse(require('fs').readFileSync(localUpdateFile, 'utf8'))
        if (localUpdate?.hasUpdate && localUpdate.latestVersion !== currentVersion) {
          return {
            hasUpdate:     true,
            latestVersion: localUpdate.latestVersion,
            // Fichier .exe téléversé localement → servi par le serveur local intégré
            releaseUrl:    localUpdate.downloadPath
              ? `http://127.0.0.1:${PORT}${localUpdate.downloadPath}`
              : (localUpdate.releaseUrl ?? null),
            releaseNotes:  localUpdate.releaseNotes ?? null,
            source:        'local-admin',
          }
        }
      } catch { /* no local update file — ok */ }

      // 3. Fall back to GitHub releases
      const data = await new Promise((resolve) => {
        const options = {
          hostname: 'api.github.com',
          path:     '/repos/garageflow/garageflow/releases/latest',
          headers:  { 'User-Agent': 'GarageFlow/' + currentVersion },
          timeout:  10_000,
        }
        require('https').get(options, res => {
          let raw = ''
          res.on('data', c => raw += c)
          res.on('end',  () => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
        }).on('error', () => resolve(null)).on('timeout', () => resolve(null))
      })

      if (!data || !data.tag_name) return { hasUpdate: false }
      const latest = String(data.tag_name).replace(/^v/, '')
      return {
        hasUpdate:     latest !== currentVersion && latest > currentVersion,
        latestVersion: latest,
        releaseUrl:    data.html_url ?? null,
        releaseNotes:  data.body ? data.body.slice(0, 500) : null,
        source:        'github',
      }
    } catch (err) {
      log('[check-updates] error:', err.message)
      return { hasUpdate: false, error: err.message }
    }
  })

  ipcMain.handle('app:online-status', async () => {
    const online = await checkInternetConnectivity()
    const rec    = readLastOnline()
    return { online, lastOnlineTs: rec?.ts ?? null }
  })

  // Return the first local network IPv4 address (for QR code / portal link sharing)
  ipcMain.handle('app:local-ip', () => {
    const nets = os.networkInterfaces()
    for (const list of Object.values(nets)) {
      for (const net of (list ?? [])) {
        if (net.family === 'IPv4' && !net.internal) return net.address
      }
    }
    return null
  })

  // ── Control-plane IPC (modules, notifications, crash consent, breadcrumbs) ──

  // Modules autorisés (entitlements) — source de vérité serveur, cache HWID.
  ipcMain.handle('app:entitlements', () => ({ modules: currentModules }))

  // Notifications côté serveur (déjà ciblées pour cette licence).
  ipcMain.handle('app:notifications', async () => {
    await fetchNotifications().catch(() => {})
    return { notifications: currentNotifs }
  })
  ipcMain.handle('app:ack-notification', async (_e, notificationId) => {
    const base = cp.resolveRemoteBase(process.env)
    const lid  = activeLicense?.payload?.lid
    if (!base || !lid || !notificationId) return { ok: false }
    const res = await httpPost(`${base}/api/notifications/ack`, {
      licenseId: lid, notificationId, hwid: getHwid(),
    }).catch(() => null)
    return { ok: !!(res && res.ok) }
  })

  // Consentement au reporting de crash (RGPD — l'utilisateur maîtrise).
  ipcMain.handle('app:crash-consent',     () => ({ consent: crashConsent() }))
  ipcMain.handle('app:set-crash-consent', (_e, value) => {
    writeSettings({ crashConsent: !!value })
    return { consent: crashConsent() }
  })

  // Le renderer signale un crash / une erreur, et dépose des « miettes ».
  ipcMain.handle('app:report-crash', async (_e, info) => {
    await reportCrash({
      message: info?.message || 'renderer_error',
      stack:   info?.stack || null,
      fatal:   info?.fatal ?? false,
      kind:    'renderer',
    })
    return { ok: true }
  })
  ipcMain.on('app:breadcrumb', (_e, action) => { pushBreadcrumb(action) })

  // ── Install update: download the .exe and run the installer ───────────────
  // Les données utilisateur sont dans userData (garageflow.db) → conservées.
  // L'installeur NSIS met à jour l'app en place sans toucher aux données.
  ipcMain.handle('app:install-update', async (_event, url) => {
    if (!url || typeof url !== 'string') return { ok: false, reason: 'URL manquante' }

    const { spawn } = require('child_process')
    const tmpDir = require('os').tmpdir()

    // Detect if this is a direct installer URL (ends with known extension)
    const installerExts = ['.exe', '.msi', '.dmg', '.pkg', '.AppImage', '.deb', '.rpm', '.zip']
    const urlLower = url.toLowerCase().split('?')[0]
    const isDirectFile = installerExts.some(ext => urlLower.endsWith(ext))

    if (!isDirectFile) {
      // Not a direct installer (e.g. a web page) — open in browser as fallback
      shell.openExternal(url)
      return { ok: true, method: 'browser', url }
    }

    // Sauvegarde de sécurité de la base AVANT toute installation
    try { runBackup() } catch (e) { log('[install-update] pre-update backup failed:', e.message) }

    const emit = (pct) => { try { mainWindow?.webContents.send('app:update-progress', pct) } catch (_) {} }

    const fileName = decodeURIComponent((url.split('/').pop() || 'GarageFlow-Setup.exe').split('?')[0])
    const destPath = path.join(tmpDir, fileName)

    // Téléchargement avec suivi de progression + suivi des redirections
    function download(u, redirects) {
      return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Trop de redirections'))
        const mod = u.startsWith('https') ? require('https') : http
        const req = mod.get(u, { timeout: 300_000 }, res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            resolve(download(res.headers.location, redirects + 1))
            return
          }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }

          const total = parseInt(res.headers['content-length'] || '0', 10)
          let received = 0
          const file = fs.createWriteStream(destPath)
          res.on('data', chunk => {
            received += chunk.length
            if (total) emit(Math.min(99, Math.round((received / total) * 100)))
          })
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          file.on('error', err => { try { fs.unlinkSync(destPath) } catch (_) {} ; reject(err) })
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Délai de téléchargement dépassé')) })
      })
    }

    try {
      emit(0)
      await download(url, 0)
      emit(100)

      // IMPORTANT : il faut FERMER GarageFlow avant que l'installeur ne s'exécute.
      // Sinon l'installeur NSIS ne peut pas remplacer le .exe / les fichiers
      // encore verrouillés par l'application en cours → l'installation échoue.
      // On lance donc l'installeur en processus DÉTACHÉ (il survit à la fermeture)
      // puis on quitte l'app pour lui laisser la main.
      try { mainWindow?.webContents.send('app:update-installing') } catch (_) {}
      log('[install-update] launching installer and quitting app:', destPath)

      const launchInstaller = () => {
        try {
          const child = spawn(destPath, [], { detached: true, stdio: 'ignore' })
          child.unref()
        } catch (e) {
          log('[install-update] spawn failed, fallback openPath:', e.message)
          try { shell.openPath(destPath) } catch (_) {}
        }
      }

      // Laisse ~1,2 s à l'UI pour afficher « fermeture… », lance l'installeur,
      // puis ferme proprement (le serveur Next est arrêté dans window-all-closed).
      setTimeout(() => {
        launchInstaller()
        // Petit délai pour que le process détaché démarre avant le quit.
        setTimeout(() => {
          try { if (nextServer) { nextServer.kill(); nextServer = null } } catch (_) {}
          app.quit()
          // Filet de sécurité si un handler retient le quit.
          setTimeout(() => app.exit(0), 1500)
        }, 800)
      }, 1200)

      return { ok: true, method: 'installed', path: destPath, closing: true }
    } catch (err) {
      log('[install-update] download failed, opening browser:', err.message)
      shell.openExternal(url)
      return { ok: true, method: 'browser-fallback', url, error: err.message }
    }
  })

  // ── Runtime license update (change/upgrade from the UI) ───────────────────
  ipcMain.handle('app:update-license', async (_event, token) => {
    try {
      if (typeof token !== 'string' || !token.trim()) {
        return { ok: false, reason: 'Token vide' }
      }
      const payload = verifyEccToken(token.trim())
      if (!payload) {
        return { ok: false, reason: 'Licence invalide ou expirée' }
      }
      // Save new license to disk (encrypted with HWID)
      saveLicense(token.trim(), payload)
      // Update in-memory license
      activeLicense = { token: token.trim(), payload }
      // Re-inject session cookies so Next.js picks up the new type
      await injectLicenseCookies(payload.typ, payload.lid ?? 'runtime')
      log('[update-license] upgraded to type:', payload.typ, '| lid:', payload.lid)
      return {
        ok:          true,
        licenseType: payload.typ,
        expiryAt:    new Date(payload.exp * 1000).toISOString(),
        isAdmin:     payload.typ === 'admin',
      }
    } catch (err) {
      log('[update-license] error:', err.message)
      return { ok: false, reason: err.message }
    }
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  log('═══════════════════════════════════')
  log('GarageFlow v' + app.getVersion() + ' starting')
  log('userData:', APP_DATA)
  log('IS_DEV:', IS_DEV)
  log('Platform:', process.platform, process.arch)

  checkDebugger()
  registerCrashHandlers()
  checkClockIntegrity()
  currentModules = loadEntitlements()
  setupIPC()
  createSplash()
  setupDatabase()

  // ── License check ──────────────────────────────────────────────────────────
  if (!IS_DEV) {
    let payload = checkStoredLicense()

    if (!payload) {
      log('No valid license — showing activation window')
      const activated = await createLicenseWindow()
      if (!activated || !activeLicense) {
        log('Activation cancelled — quitting')
        app.quit()
        return
      }
      payload = activeLicense.payload
    } else {
      activeLicense = { token: loadLicense()?.token ?? '', payload }
      log('Stored license OK — lid:', payload.lid, '| type:', payload.typ)
    }

    // Inject cookies so Next.js middleware is satisfied
    await injectLicenseCookies(payload.typ, payload.lid ?? 'prod')
  } else {
    log('DEV mode: skipping license check')
    // In dev, inject a mock cookie so the app works without a real token
    await injectLicenseCookies('admin', 'dev')
  }

  // ── Start Next.js server ───────────────────────────────────────────────────
  try {
    await startNextServer()
  } catch (err) {
    log('FATAL:', err.message)
    dialog.showErrorBox(
      'Erreur de démarrage GarageFlow',
      `Impossible de démarrer le serveur.\n\n${err.message}\n\nRéinstallez l'application.`
    )
    app.quit()
    return
  }

  // ── Run additive DB schema migrations via internal API ──────────────────
  // Awaited so the schema is up to date before the user can interact with the app
  await runInternalMigration().catch(err => log('Migration error (non-fatal):', err.message))

  // ── Open main window ──────────────────────────────────────────────────────
  createMainWindow()

  // Diffuse les modules connus + récupère les notifications dès l'ouverture.
  broadcastEntitlements()
  if (!IS_DEV) {
    setTimeout(() => { fetchNotifications().catch(() => {}); flushCrashQueue().catch(() => {}) }, 5_000)
  }

  // ── Auto-backup ────────────────────────────────────────────────────────────
  runBackup()
  backupTimer = setInterval(runBackup, 60 * 60 * 1_000)

  // ── Daily desktop export at 20:00 ─────────────────────────────────────────
  scheduleDailyDesktopExport()

  // ── Periodic license revocation check (production only) ───────────────────
  if (!IS_DEV) {
    startPeriodicLicenseCheck()
    startOnlineGraceCheck()
  }
})

app.on('window-all-closed', () => {
  if (backupTimer)       { clearInterval(backupTimer);         backupTimer       = null }
  if (licenseTimer)      { clearTimeout(licenseTimer);         licenseTimer      = null }
  if (onlineCheckTimer)  { clearInterval(onlineCheckTimer);    onlineCheckTimer  = null }
  if (desktopExportTimer){ clearTimeout(desktopExportTimer);   desktopExportTimer = null }
  if (nextServer) {
    const pid = nextServer.pid
    log('Stopping Next.js server (pid ' + pid + ')…')
    try { nextServer.kill() } catch (_) {}
    nextServer = null
  }
  app.quit()
})

// Single instance lock — bring existing window to front
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

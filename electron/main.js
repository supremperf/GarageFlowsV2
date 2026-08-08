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

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session, utilityProcess, safeStorage } = require('electron')
const path    = require('path')
const fs      = require('fs')
const http    = require('http')
const crypto  = require('crypto')
const os      = require('os')
const { resolveMainSecret } = require('./secret')
const { sign: signState, verify: verifyState } = require('./signed-state')

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
        // Aucun secret codé en dur : NEXTAUTH_SECRET est résolu par installation
        // (voir resolveInstallSecret() dans app.whenReady) et injecté à l'exécution.
        fs.writeFileSync(envFile, [
          'DATABASE_URL="file:./dev.db"',
          'NEXTAUTH_URL="http://localhost:3000"',
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

// ── Compatibilité des données après passage de productName à « GarageFlows » ──
// La marque VISIBLE (productName, exe, raccourci, désinstalleur) devient
// « GarageFlows ». Mais le dossier de données utilisateur est DÉRIVÉ de app name
// (%APPDATA%/<productName>). On l'ÉPINGLE explicitement sur le nom HISTORIQUE
// « GarageFlow » pour que les installations existantes conservent leur base
// (garageflow.db), leur licence et leur secret d'installation. AUCUN échec
// silencieux : si l'épinglage ne prend pas, les données seraient créées dans un
// MAUVAIS dossier (perte silencieuse de BD/licence) → l'erreur est journalisée
// et l'application s'ARRÊTE de façon contrôlée au ready (avant toute écriture).
// DOIT précéder tout app.getPath('userData'). Logique pure/testée :
// electron/user-data-path.js (+ src/lib/__tests__/user-data-path.test.ts).
const { pinUserDataToLegacyDir } = require('./user-data-path')
const USER_DATA_PIN = pinUserDataToLegacyDir(app)
if (!USER_DATA_PIN.ok) {
  // console.error : le log fichier (LOG_PATH) dépend justement de userData.
  // Aucun secret ni donnée sensible — uniquement le motif technique.
  console.error('[FATAL] userData pinning failed:', USER_DATA_PIN.error)
}

// ── Constants ─────────────────────────────────────────────────────────────────

// SÉCURITÉ LICENCE : ELECTRON_DEV n'est honoré QUE dans un build non packagé
// (développement). Dans un build packagé (production), app.isPackaged === true
// force IS_DEV à false quelle que soit la variable d'environnement — sinon
// `set ELECTRON_DEV=1 && GarageFlow.exe` sauterait tout le contrôle de licence
// et injecterait un cookie admin (contournement trivial dans un modèle desktop
// où l'utilisateur est l'adversaire).
const IS_DEV      = !app.isPackaged && process.env.ELECTRON_DEV === '1'
const PORT        = 4028

// ── Origine unique côté NAVIGATEUR ───────────────────────────────────────────
//
// Tout ce que le renderer voit — URL de la fenêtre, cookies injectés, NEXTAUTH_URL
// — DOIT porter cette seule et même origine. Une divergence provoquait l'« écran
// noir » au démarrage.
//
// Pourquoi « localhost » et non « 127.0.0.1 » : Next construit toute URL interne
// via `NextURL` → `parseURL()`, qui applique REGEX_LOCALHOST_HOSTNAME
// (next/dist/server/web/next-url.js) et réécrit INCONDITIONNELLEMENT tout hôte
// 127.x.x.x / [::1] en « localhost ». Aucune option ne la désactive : mesuré sur
// le serveur standalone réel, une fenêtre chargée sur http://127.0.0.1:PORT
// recevait un « Location: http://localhost:PORT/login », donc une AUTRE origine.
// Le cookie gf_session (posé sur 127.0.0.1) n'était plus envoyé, et surtout le
// garde `will-redirect` bloquait le saut hors origine → la fenêtre principale ne
// chargeait JAMAIS et le splash restait affiché indéfiniment.
// Émettre un `Location` relatif depuis le middleware n'est pas une issue :
// l'adaptateur de Next parse ce header en `NextURL` AVANT toute vérification
// (server/web/adapter.js) et lève « TypeError: Invalid URL » → 500 (mesuré).
// On aligne donc l'origine du client sur celle que Next impose.
//
// L'ÉCOUTE, elle, reste sur 127.0.0.1 (voir HOSTNAME plus bas) : jamais exposée
// au LAN. Les appels internes de ce fichier (main → serveur) visent directement
// 127.0.0.1, sans DNS.
const APP_ORIGIN  = `http://localhost:${PORT}`

// « localhost » résout sur cette machine en [::1] PUIS 127.0.0.1 (mesuré). Le
// serveur n'écoutant que sur 127.0.0.1, Chromium tenterait ::1 d'abord et ne
// réussirait que par repli — délai variable, et échec net si le repli est filtré.
// Cette règle force la résolution côté Chromium : plus de tentative ::1.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1')
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
// This is a PUBLIC key — distributing it is safe; you cannot forge signatures without private.pem
//
// SOURCE DE VÉRITÉ UNIQUE : ces lignes DOIVENT rester identiques à keys/public.pem
// (la clé dont keys/private.pem signe les licences). `npm run check:public-key`,
// intégré à check:consistency et donc au release gate, ÉCHOUE si les deux
// divergent — la divergence est silencieuse et catastrophique en production :
// verify() renvoie simplement false, la licence pourtant valide est refusée,
// l'application repart en activation, et le serveur la refuse quand le quota
// d'appareils est atteint. L'utilisateur est alors verrouillé hors de son
// logiciel sans le moindre message expliquant pourquoi.
// (Cas réellement observé : le dépôt portait une clé issue d'un keygen antérieur
//  tandis que les licences émises l'étaient par celle de keys/public.pem.)
const _PK = [
  '-----BEGIN PUBLIC KEY-----',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXOkZzbqVmq/ZPhHEWa2hCyQG0d/W',
  'Y+SVGFD/W/tmZyVoKinaUwHYISXZZrJK8dHqvEWvoRtBldeEREJmF0A2Ow==',
  '-----END PUBLIC KEY-----',
]
const PUBLIC_KEY_PEM = _PK.join('\n')

// ── Control-plane helpers (modules, crashs, clock-tamper, notifications) ──────
const cp = require('./control-plane')
const updateVerify = require('./update-verify')
const semver = require('./semver')

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
let activeDeviceToken = null   // device token issued by the server on activation (device auth)
let desktopExportTimer = null
let onlineCheckTimer  = null   // periodic internet connectivity check
let installSecret     = null   // secret par installation (session JWT + NEXTAUTH_SECRET serveur)
let updateTimer       = null   // periodic app-update check (startup + hourly)
let lastNotifiedUpdate = null  // version already announced to the renderer (anti-spam)

// ── Central update server (source of truth for app releases) ──────────────────
// Priorité : GF_UPDATE_SERVER, sinon GF_LICENSE_SERVER, sinon l'URL officielle
// par défaut (app.garageflows.fr héberge licences ET mises à jour). Le défaut
// permet à l'app packagée de contacter le serveur SANS .env (non embarqué), tout
// en restant surchargeable par variable d'environnement (dev/staging).
// Canal par défaut : « stable ».
const UPDATE_SERVER  = (process.env.GF_UPDATE_SERVER || process.env.GF_LICENSE_SERVER
    || 'https://app.garageflows.fr').replace(/\/$/, '')
// UPDATE_CHANNEL est déjà déclaré plus haut (socle) — pas de redéclaration ici.

// ── Autorité de licence (source de vérité activation/révocation) ──────────────
// URL officielle COMPILÉE (comme UPDATE_SERVER) : une app packagée sans .env doit
// TOUJOURS pouvoir joindre l'autorité distante (révocation/suspension), sinon la
// licence serait silencieusement désactivée. Surcharge GF_LICENSE_SERVER pour
// dev/staging/self-hosted ; en prod packagée, une surcharge non-https est refusée.
const { resolveLicenseServer } = require('./license-endpoint')
const LICENSE_SERVER = resolveLicenseServer({ envUrl: process.env.GF_LICENSE_SERVER, isPackaged: app.isPackaged })

// ── App-update helpers ────────────────────────────────────────────────────────

// GET JSON avec timeout + suivi de redirections (jamais de throw → resolve(null)).
function httpGetJson(url, timeoutMs = 6000, redirects = 0) {
  return new Promise(resolve => {
    try {
      if (redirects > 5) return resolve(null)
      const mod = url.startsWith('https') ? require('https') : http
      const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'GarageFlow/' + app.getVersion() } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); resolve(httpGetJson(res.headers.location, timeoutMs, redirects + 1)); return
        }
        let raw = ''
        res.on('data', c => (raw += c))
        res.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    } catch { resolve(null) }
  })
}

// Empreinte SHA-256 (hex) d'un fichier, en flux (pas de mise en mémoire).
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(filePath)
    s.on('data', d => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

// Interroge le serveur central et renvoie un objet de mise à jour homogène.
// Ordre : serveur central (/api/update/latest) → fichier local admin →
// Releases GitHub (repli, non vérifiable). Si le serveur central répond
// « pas de maj », on s'y fie (pas de repli GitHub qui ferait un faux positif).
async function fetchLatestUpdate() {
  const currentVersion = app.getVersion()

  if (UPDATE_SERVER) {
    // Le HWID permet le déploiement progressif côté serveur (rollout ciblé).
    const q = `?version=${encodeURIComponent(currentVersion)}&channel=${encodeURIComponent(UPDATE_CHANNEL)}`
            + `&hwid=${encodeURIComponent(getHwid())}`
    const data = await httpGetJson(`${UPDATE_SERVER}/api/update/latest${q}`, 6000)
    if (data && typeof data.hasUpdate === 'boolean') {
      if (data.hasUpdate && data.latest) {
        return {
          hasUpdate:     true,
          currentVersion,
          latestVersion: data.latest.version,
          title:         data.latest.title ?? null,
          releaseNotes:  data.latest.changelog ?? null,
          downloadUrl:   data.latest.downloadUrl ?? null,
          releaseUrl:    data.latest.downloadUrl ?? null, // rétro-compat renderer
          sha256:        data.latest.sha256 ?? null,
          size:          data.latest.size ?? null,
          fileName:      data.latest.fileName ?? null,
          mandatory:     Boolean(data.mandatory),
          minVersion:    data.latest.minVersion ?? null,
          // Manifeste signé Ed25519 : autorité pour sha256/size/downloadUrl/version
          // (vérifié dans app:install-update quand une clé publique est embarquée).
          manifest:      data.manifest ?? data.latest.manifest ?? null,
          source:        'central',
        }
      }
      return { hasUpdate: false, currentVersion, source: 'central' }
    }
    // Serveur injoignable / réponse inattendue → on tente les replis ci-dessous.
  }

  // Fichier local publié par le serveur intégré (mono-poste / hors-ligne).
  try {
    const localUpdate = JSON.parse(fs.readFileSync(path.join(APP_DATA, 'gf_update.json'), 'utf8'))
    if (localUpdate?.hasUpdate && localUpdate.latestVersion !== currentVersion) {
      const dl = localUpdate.downloadPath ? `http://127.0.0.1:${PORT}${localUpdate.downloadPath}` : (localUpdate.releaseUrl ?? null)
      return {
        hasUpdate:     true,
        currentVersion,
        latestVersion: localUpdate.latestVersion,
        releaseNotes:  localUpdate.releaseNotes ?? null,
        downloadUrl:   dl,
        releaseUrl:    dl,
        sha256:        localUpdate.sha256 ?? null,
        size:          localUpdate.fileSize ?? null,
        mandatory:     Boolean(localUpdate.mandatory),
        source:        'local-admin',
      }
    }
  } catch { /* pas de fichier local — ok */ }

  // Repli : Releases GitHub (pas d'empreinte → non vérifiable, ouverture navigateur).
  const gh = await httpGetJson('https://api.github.com/repos/garageflow/garageflow/releases/latest', 8000)
  if (gh?.tag_name) {
    const latest = String(gh.tag_name).replace(/^v/, '')
    return {
      // Comparaison SemVer (jamais lexicographique : « 1.9.0 » < « 1.10.0 »).
      hasUpdate:     semver.isNewer(latest, currentVersion),
      currentVersion,
      latestVersion: latest,
      releaseNotes:  gh.body ? gh.body.slice(0, 800) : null,
      downloadUrl:   gh.html_url ?? null,
      releaseUrl:    gh.html_url ?? null,
      sha256:        null,
      mandatory:     false,
      source:        'github',
    }
  }

  return { hasUpdate: false, currentVersion }
}

// Contrôle au démarrage (~25 s) puis toutes les heures ; notifie le renderer.
function startPeriodicUpdateCheck() {
  const runCheck = async () => {
    try {
      const info = await fetchLatestUpdate()
      if (info?.hasUpdate && info.latestVersion && info.latestVersion !== lastNotifiedUpdate) {
        lastNotifiedUpdate = info.latestVersion
        try { mainWindow?.webContents.send('app:update-available', info) } catch (_) {}
        log('[update] version disponible:', info.latestVersion, '| obligatoire:', !!info.mandatory)
      }
    } catch (err) {
      log('[update] check error:', err.message)
    }
  }
  setTimeout(runCheck, 25_000)
  if (updateTimer) clearInterval(updateTimer)
  updateTimer = setInterval(runCheck, 60 * 60 * 1_000)
}

// One-time secret for internal API calls (export endpoint)
const INTERNAL_EXPORT_KEY = crypto.randomBytes(32).toString('hex')

// ── Secret local par installation (fail-closed) ────────────────────────────────
// Résout un secret propre à l'installation (256 bits, stocké dans userData avec
// permissions restrictives). Respecte un NEXTAUTH_SECRET déjà fort (dev/.env).
// En cas d'échec on refuse de démarrer la partie authentifiée. La valeur n'est
// JAMAIS journalisée.
function resolveInstallSecret() {
  const { secret, source } = resolveMainSecret(APP_DATA, process.env.NEXTAUTH_SECRET)
  installSecret = secret
  // Aligne process.env pour tout code aval qui lirait encore NEXTAUTH_SECRET.
  process.env.NEXTAUTH_SECRET = secret
  log(`Secret local prêt (source: ${source})`)   // ne journalise jamais la valeur
}

// ── Online check state ────────────────────────────────────────────────────────
const ONLINE_CHECK_FILE    = () => path.join(APP_DATA, 'last_online.json')
const GRACE_PERIOD_MS      = 48 * 60 * 60 * 1_000   // 48 hours
const LOCK_PERIOD_MS       = 72 * 60 * 60 * 1_000   // 72 hours (lock after grace)
// La sonde de connectivité vise désormais l'AUTORITÉ de licence (LICENSE_SERVER)
// et non plus une URL générique — voir checkInternetConnectivity().

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
/**
 * Empreinte courte de la clé publique EMBARQUÉE, pour le journal uniquement.
 * SHA-256 du DER, 12 hex — suffisant pour comparer deux builds entre eux sans
 * jamais écrire la clé. Ne lève jamais : le diagnostic ne doit pas ajouter une
 * panne à la panne qu'il documente.
 */
function publicKeyFingerprint() {
  try {
    const der = crypto.createPublicKey(PUBLIC_KEY_PEM).export({ type: 'spki', format: 'der' })
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 12)
  } catch {
    return 'indisponible'
  }
}

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
    if (!verifier.verify({ key: PUBLIC_KEY_PEM, format: 'pem' }, sig)) {
      // Ce rejet était TOTALEMENT muet : la seule trace était « No valid license »
      // plus haut, indiscernable d'une absence de licence. Diagnostiquer une clé
      // embarquée divergente demandait alors de désosser le binaire.
      // On journalise une empreinte TRONQUÉE de la clé de vérification (une clé
      // publique n'est pas un secret, mais on n'en écrit jamais le corps complet).
      log('Signature de licence invalide — la clé publique embarquée ne correspond',
          'pas à la clé émettrice. Empreinte clé embarquée:', publicKeyFingerprint())
      return null
    }

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

// ── HWID check — comparaison STRICTE, aucune tolérance partielle ─────────────
// Un HWID est un digest SHA-256 : le moindre changement matériel modifie tout
// le hachage (effet d'avalanche), donc une tolérance de N % n'a aucun sens et
// affaiblit le lien. De plus la licence stockée est chiffrée avec une clé
// dérivée du HWID complet : un match exact est déjà requis pour la déchiffrer.
function hwidMatches(stored, current) {
  if (!stored) return true   // licence non liée au matériel
  const a = String(stored).trim().toLowerCase()
  const b = String(current).trim().toLowerCase()
  const hex64 = /^[0-9a-f]{64}$/
  if (!hex64.test(a) || !hex64.test(b)) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
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

function saveLicense(token, payload, deviceToken = activeDeviceToken) {
  try {
    const key = deriveStorageKey()
    const iv  = crypto.randomBytes(12)
    const plain = JSON.stringify({
      token,
      payload,
      deviceToken: deviceToken ?? null,
      savedAt:    Date.now(),
      hwid:       getHwid(),
      appVersion: app.getVersion(),
    })
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()
    // Inner layout: IV(12) + AuthTag(16) + Ciphertext (clé dérivée du HWID)
    const innerBlob = Buffer.concat([iv, tag, enc])
    // Couche supplémentaire : stockage sécurisé de l'OS (DPAPI/Keychain/libsecret)
    // quand il est disponible — le fichier contient le deviceToken, il bénéficie
    // ainsi du chiffrement lié au compte utilisateur EN PLUS du lien matériel.
    // Format: 'GFS1' + safeStorage(base64(innerBlob)). Repli sûr : format legacy.
    let outBlob = innerBlob
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        outBlob = Buffer.concat([Buffer.from('GFS1'), safeStorage.encryptString(innerBlob.toString('base64'))])
      }
    } catch (_) { outBlob = innerBlob }
    fs.writeFileSync(LIC_PATH, outBlob)
    log('License saved — lid:', payload.lid, '| type:', payload.typ)
  } catch (err) {
    log('saveLicense error:', err.message)
  }
}

function loadLicense() {
  try {
    if (!fs.existsSync(LIC_PATH)) return null
    let buf = fs.readFileSync(LIC_PATH)
    // Format 'GFS1' = enveloppe safeStorage (OS) autour du blob AES-GCM.
    // Les fichiers d'installations antérieures (sans enveloppe) restent lisibles.
    if (buf.length > 4 && buf.subarray(0, 4).toString('utf8') === 'GFS1') {
      try {
        buf = Buffer.from(safeStorage.decryptString(buf.subarray(4)), 'base64')
      } catch (_) {
        // safeStorage indisponible / autre compte OS : illisible = non licencié.
        return null
      }
    }
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
/**
 * Consentement crash — OPT-IN : par défaut DÉSACTIVÉ (false). Aucun rapport n'est
 * envoyé tant que l'utilisateur n'a pas explicitement accepté (RGPD).
 */
function crashConsent() {
  const s = readSettings()
  return s.crashConsent === true
}
/** L'utilisateur a-t-il déjà fait un choix explicite (pour l'écran de 1er lancement) ? */
function crashConsentDecided() {
  return typeof readSettings().crashConsent === 'boolean'
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
  // Signé (HMAC + hwid) : un gf_clock.json édité à la main (p. ex. wall=0 pour
  // masquer un recul d'horloge) est rejeté → traité comme absence de référence.
  try { return verifyState(fs.readFileSync(TRUSTED_CLOCK_PATH, 'utf8'), installSecret, getHwid()) } catch { return null }
}
function writeTrustedClock(wall) {
  if (!installSecret) return
  try { fs.writeFileSync(TRUSTED_CLOCK_PATH, signState({ wall }, installSecret, getHwid()), 'utf8') } catch (_) {}
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
    // Redaction centralisée + minimisation (jamais de secret/token/chemin utilisateur/HWID brut).
    const payload = cp.sanitizeCrashReport({
      licenseId:   activeLicense?.payload?.lid ?? null,
      hwid:        getHwid(),
      appVersion:  info.version,
      channel:     UPDATE_CHANNEL,
      os:          info.os,
      arch:        info.arch,
      cpu:         info.cpu,
      ramMb:       info.ramMb,
      message,
      stack,
      breadcrumbs: JSON.stringify(breadcrumbs),
      logs:        logsTail,
      fatal,
      kind,
    })
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

  // Restore the device token (device auth) so the heartbeat can present it.
  if (stored.deviceToken) activeDeviceToken = stored.deviceToken

  // Optional HWID binding (from token payload)
  if (payload.hwid) {
    const currentHwid = getHwid()
    if (!hwidMatches(payload.hwid, currentHwid)) {
      // Jamais de HWID complet dans les logs — empreinte tronquée uniquement.
      log('HWID mismatch — token requires:', String(payload.hwid).slice(0, 12) + '…',
          'current:', String(currentHwid).slice(0, 12) + '…')
      return null
    }
  }

  return payload
}

// ── Inject license cookies into Electron session ──────────────────────────────
// The Next.js middleware (src/middleware.ts) checks for a signed HS256 JWT in
// the "gf_session" cookie.  Electron must mint that token itself so that every
// page request is allowed through the middleware gate.

function createGfSessionJwt(typ, lid, extra = {}) {
  // Secret par installation, résolu au démarrage (fail-closed). Aucun repli en dur.
  const secret  = installSecret
  if (!secret) throw new Error('Secret local indisponible — session non signable')
  const now     = Math.floor(Date.now() / 1000)
  const exp     = now + 5 * 365 * 24 * 3600   // 5 years

  // Standard HS256 JWT — compatible with jose's jwtVerify()
  // `extra` porte les revendications MÉCANICIEN (gid, mid, did) le cas échéant.
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ typ, lid, ...extra, iat: now, exp })).toString('base64url')
  const sig     = crypto.createHmac('sha256', secret)
                        .update(`${header}.${payload}`)
                        .digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function injectLicenseCookies(licenseType, licenseId = 'electron-local', extra = {}) {
  // MÊME origine que la fenêtre (APP_ORIGIN) : un cookie posé sur une autre
  // origine ne serait jamais renvoyé par le renderer → l'utilisateur resterait
  // bloqué sur /license malgré une licence valide.
  const baseUrl = APP_ORIGIN
  const expDate = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600
  const jwt     = createGfSessionJwt(licenseType, licenseId, extra)

  // Primary cookie — verified by middleware. HttpOnly : inaccessible au JS du
  // renderer (contextIsolation actif) ; SameSite=Strict : jamais envoyé en
  // contexte tiers.
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_session',
    value:          jwt,
    path:           '/',
    expirationDate: expDate,
    httpOnly:       true,
    sameSite:       'strict',
  })

  // Legacy cookies kept for any code still reading them (état UI uniquement,
  // jamais utilisés pour le contrôle d'accès).
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_license_validated',
    value:          '1',
    path:           '/',
    expirationDate: expDate,
    sameSite:       'strict',
  })
  await session.defaultSession.cookies.set({
    url:            baseUrl,
    name:           'gf_license_type',
    value:          licenseType,
    path:           '/',
    expirationDate: expDate,
    sameSite:       'strict',
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
        'GarageFlows — Base de données manquante',
        'Le fichier de base de données n\'a pas été trouvé dans les ressources de l\'application.\n\n' +
        'resourcesPath: ' + rp + '\n\n' +
        'Consultez le fichier log pour plus de détails :\n' + LOG_PATH + '\n\n' +
        'Solution : désinstallez GarageFlows puis réinstallez-le depuis le fichier d\'installation fourni.'
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

// NB : httpGetJson est défini plus haut (avec timeout, User-Agent et suivi de
// redirections). Un DOUBLON défini ici auparavant écrasait cette version (les
// déclarations de fonction étant hoistées, la dernière gagne) et désactivait
// SILENCIEUSEMENT le suivi de redirections et l'en-tête User-Agent — cassant p.
// ex. l'API GitHub (403 sans User-Agent) et toute réponse 3xx. Doublon supprimé.

// ── Server-side activation: register THIS device, obtain a device token ───────
// Device auth: the heartbeat REQUIRES a signed device token. This registers the
// machine (HWID) against the license and stores the returned token. Best-effort:
// if the server is unreachable the app still starts offline; the next online
// heartbeat returns { deviceRequired:true } and re-triggers this to get a token.
/**
 * Motif du DERNIER refus explicite de l'autorité distante (ex. limite
 * d'appareils atteinte). Conservé pour être présenté à l'utilisateur : sans
 * cela, le seul message actionnable — « Désactivez un appareil ou contactez
 * votre revendeur » — restait enfermé dans le journal.
 */
let lastRemoteActivationRefusal = null

/** Motif déjà présenté à l'écran — évite de renvoyer le même à chaque battement. */
let shownActivationRefusal = null

/** Battements consécutifs où l'appareil n'a pas pu s'enregistrer. */
let deviceRetryStreak = 0

/** Au bout de N échecs d'affilée, on le signale UNE fois dans le journal. */
const DEVICE_RETRY_WARN_AT = 5

/**
 * Enregistre CET appareil et récupère un jeton d'appareil.
 *
 * Renvoie l'AUTORITÉ qui a délivré le jeton — 'remote' ou 'local' — ou null en
 * cas d'échec. Cette distinction est essentielle : un jeton émis par le repli
 * local ne satisfait PAS l'autorité distante, qui l'ignore et redemande aussitôt
 * un appareil. Renvoyer un simple booléen faisait passer les deux cas pour un
 * succès et enfermait l'application dans une boucle de réactivation sans fin
 * (136 tentatives observées dans garageflow.log, une toutes les 2 minutes).
 */
async function activateOnServer() {
  if (!activeLicense?.token) return null

  const info = getSystemInfo()
  const body = {
    license: activeLicense.token,
    hwid:    getHwid(),
    version: info.version,
    os:      info.os,
    arch:    info.arch,
  }

  // Autorité distante COMPILÉE en priorité, repli serveur local (127.0.0.1).
  const bases = [
    { url: LICENSE_SERVER,             authority: 'remote' },
    { url: `http://127.0.0.1:${PORT}`, authority: 'local'  },
  ]

  for (const { url, authority } of bases) {
    const res = await httpPost(`${url}/api/license/activate`, body)

    if (res && res.ok && res.deviceToken) {
      activeDeviceToken = res.deviceToken
      saveLicense(activeLicense.token, activeLicense.payload, res.deviceToken)
      if (Array.isArray(res.modules)) currentModules = res.modules.slice().sort()
      if (authority === 'remote') lastRemoteActivationRefusal = null
      log('[license/activate] device token obtained —', authority, '— deviceId:', res.deviceId || '?')
      return authority
    }

    if (res && res.ok === false) {
      const reason = res.reason || res.status || 'refus sans motif'
      log('[license/activate] server refused —', authority, '—', reason)
      if (authority === 'remote') {
        // Un REFUS EXPLICITE de l'autorité est une réponse DÉFINITIVE, pas une
        // panne : on n'essaie PAS le repli local derrière. Le faire revenait à
        // laisser le serveur local délivrer un jeton que l'autorité venait de
        // refuser — ce qui rendait inopérante la limite d'appareils (une
        // décision commerciale) tout en amorçant la boucle sans fin.
        lastRemoteActivationRefusal = String(reason)
        return null
      }
    }
    // res === null → autorité injoignable (et non refus) : le repli est légitime.
  }
  return null
}

/**
 * Établit la session MÉCANICIEN locale (mono-poste). Une clé mécanicien exige
 * une session portant gid + mid ; on interroge l'activation locale pour les
 * obtenir puis on réinjecte le cookie complet. Best-effort : si la clé n'est pas
 * (encore) attribuée localement, la session reste incomplète et les API
 * mécanicien refusent l'accès (fail-closed) — jamais d'accès élargi.
 */
async function establishMechanicSession() {
  if (!activeLicense?.token) return false
  const info = getSystemInfo()
  const body = {
    license: activeLicense.token,
    hwid:    getHwid(),
    version: info.version,
    os:      info.os,
    arch:    info.arch,
  }
  const res = await httpPost(`http://127.0.0.1:${PORT}/api/license/activate`, body).catch(() => null)
  if (res && res.ok && res.licenseType === 'mechanic' && res.garageId && res.mechanicId) {
    if (res.deviceToken) {
      activeDeviceToken = res.deviceToken
      saveLicense(activeLicense.token, activeLicense.payload, res.deviceToken)
    }
    await injectLicenseCookies('mechanic', activeLicense.payload.lid, {
      gid: res.garageId,
      mid: res.mechanicId,
      ...(res.deviceId ? { did: res.deviceId } : {}),
    })
    log('[mechanic] session locale établie — mid:', res.mechanicId)
    return true
  }
  log('[mechanic] session locale indisponible —', (res && (res.reason || res.code)) || 'refus')
  return false
}

async function periodicLicenseCheck() {
  if (!activeLicense?.payload?.lid) return

  const licenseId = activeLicense.payload.lid
  let result = null

  // If we have no device token yet (fresh upgrade / offline activation), get one
  // before the heartbeat — the server rejects heartbeats without a device token.
  if (!activeDeviceToken) await activateOnServer()

  // Télémétrie technique jointe au heartbeat (jamais de donnée métier).
  const info = getSystemInfo()
  const body = { licenseId, deviceToken: activeDeviceToken, version: info.version, os: info.os, arch: info.arch, hwid: getHwid() }

  // 1. Check remote license server — authoritative. URL officielle compilée :
  //    toujours interrogée (révocation/suspension), même sans .env.
  const remoteServer = LICENSE_SERVER
  if (remoteServer) {
    try {
      result = await httpPost(`${remoteServer.replace(/\/$/, '')}/api/license/check`, body)
      // Ne jamais journaliser la réponse complète (elle pourrait contenir un jeton) :
      // uniquement les champs de décision.
      if (result) log('[license/check] remote result — allowed:', result.allowed,
                      '| status:', result.status ?? '?', '| deviceRequired:', !!result.deviceRequired)
    } catch (err) {
      log('[license/check] remote server unreachable (fail-open):', err.message)
    }
  }

  // 2. Fall back to local check
  if (!result) {
    try {
      result = await httpPost(`http://127.0.0.1:${PORT}/api/license/check`, body)
      if (result) log('[license/check] local result — allowed:', result.allowed,
                      '| status:', result.status ?? '?', '| deviceRequired:', !!result.deviceRequired)
    } catch (err) {
      log('[license/check] local check error (fail-open):', err.message)
    }
  }

  // No response at all (remote + local both unreachable) → indeterminate.
  // Fail-open: keep the current state, never lock a legitimate user out offline.
  if (!result) return

  // Device token missing/expired/replaced on the server side → re-activate to
  // obtain a fresh token, then re-run the heartbeat. NOT a revocation.
  if (result.deviceRequired) {
    log('[license/check] device token required — re-activating this device')
    activeDeviceToken = null
    const authority = await activateOnServer()

    // On ne re-vérifie IMMÉDIATEMENT que si le jeton vient de l'autorité qui
    // vient de l'exiger. Un jeton délivré par le repli local ne la satisfait
    // pas : la re-sonder aussitôt relançait la même exigence, en boucle.
    if (authority === 'remote') {
      deviceRetryStreak = 0
      setTimeout(() => { periodicLicenseCheck().catch(() => {}) }, 500)
      return
    }

    // Échec ou jeton purement local : on laisse le battement normal reprendre,
    // sans re-sonde immédiate, et on compte les tentatives infructueuses.
    deviceRetryStreak++

    // Refus EXPLICITE de l'autorité (ex. limite d'appareils atteinte) : seule
    // l'utilisatrice ou l'utilisateur peut débloquer la situation. Le message
    // n'existait que dans le journal — on l'affiche, une seule fois par motif.
    if (lastRemoteActivationRefusal && lastRemoteActivationRefusal !== shownActivationRefusal) {
      shownActivationRefusal = lastRemoteActivationRefusal
      log('[license/check] activation refusée par l\'autorité —', lastRemoteActivationRefusal)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license:revoked', {
          status: 'device_limit',
          reason: lastRemoteActivationRefusal,
        })
      }
    } else if (deviceRetryStreak === DEVICE_RETRY_WARN_AT) {
      // Aucun refus explicite (autorité injoignable) : on signale une fois que
      // l'appareil n'arrive pas à s'enregistrer, sans bloquer l'utilisation.
      log(`[license/check] ${deviceRetryStreak} tentatives d'enregistrement sans succès — autorité injoignable ?`)
    }
    return
  }

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
  // État SIGNÉ (HMAC lié à l'installation + hwid). Une valeur non signée,
  // falsifiée ou copiée d'une autre machine → null (fail-closed : la grâce
  // n'est pas prolongée). Voir electron/signed-state.js.
  try {
    const raw = fs.readFileSync(ONLINE_CHECK_FILE(), 'utf8')
    return verifyState(raw, installSecret, getHwid())
  } catch {
    return null
  }
}

function saveLastOnline() {
  if (!installSecret) return // sans secret d'installation, on ne signe pas
  try {
    fs.writeFileSync(ONLINE_CHECK_FILE(), signState({ ts: Date.now() }, installSecret, getHwid()), 'utf8')
  } catch (_) {}
}

function probeUrl(url) {
  return new Promise(resolve => {
    try {
      const mod = url.startsWith('http:') ? require('http') : require('https')
      // Toute réponse HTTP (même 4xx/5xx) prouve la joignabilité du serveur.
      const req = mod.get(url, { timeout: 8_000 }, res => {
        resolve(true)
        res.destroy()
      })
      req.on('error',   () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    } catch (_) { resolve(false) }
  })
}

async function checkInternetConnectivity() {
  // Anti-contournement (durci) : quand un serveur de licences est configuré,
  // « en ligne » signifie que l'AUTORITÉ de licences est joignable — c'est par
  // elle que passent les révocations. Auparavant la sonde visait 1.1.1.1 :
  // firewaller uniquement api.garageflows.fr en gardant internet maintenait la
  // période de grâce indéfiniment et rendait la révocation contournable.
  // Désormais ce scénario N'ENTRETIENT PLUS la grâce (verrou 72 h normal).
  // « En ligne » = l'AUTORITÉ de licence est joignable (c'est par elle que passe
  // la révocation). L'URL officielle étant compilée, on ne retombe plus sur une
  // sonde générique (1.1.1.1) : firewaller la seule autorité de licence tout en
  // gardant internet n'entretient donc PLUS la période de grâce indéfiniment.
  return probeUrl(`${LICENSE_SERVER.replace(/\/$/, '')}/api/health`)
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
      title:   'GarageFlows — Connexion requise',
      message: 'GarageFlows nécessite une connexion internet.',
      detail:  `${why}\nVeuillez connecter ce PC à internet pour continuer à utiliser GarageFlows.`,
      buttons: ['Fermer'],
    }).catch(() => {})
    app.quit()
  } else if (offlineMs > GRACE_PERIOD_MS) {
    const remaining = Math.ceil((LOCK_PERIOD_MS - offlineMs) / (60 * 60 * 1_000))
    log(`[online-check] offline > 48h — warning (${remaining}h remaining)`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      require('electron').dialog.showMessageBox(mainWindow, {
        type:    'warning',
        title:   'GarageFlows — Mode hors ligne',
        message: `GarageFlows est hors ligne depuis plus de 48 heures.`,
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

/**
 * Exécute les migrations SQLite via l'API interne et CONTRÔLE le résultat
 * complet : statut HTTP, corps JSON, champ `ok`. Renvoie l'objet résultat.
 * REJETTE (avec code structuré) si : erreur réseau, statut ≠ 200, JSON
 * illisible, ou ok !== true — un HTTP 500 n'est JAMAIS traité comme une
 * migration terminée. L'appelant applique le fail-closed (pas de fenêtre).
 */
async function runInternalMigration() {
  const body = JSON.stringify({})
  const { statusCode, raw } = await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: '/api/internal/migrate', method: 'POST' },
      res => {
        let acc = ''
        res.on('data', d => (acc += d))
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, raw: acc }))
      }
    )
    req.on('error', err => reject(new Error(`MIGRATION_HTTP_ERROR: ${err.message}`)))
    req.setHeader('Content-Type', 'application/json')
    req.setHeader('Content-Length', Buffer.byteLength(body))
    req.setHeader('x-internal-key', INTERNAL_EXPORT_KEY)
    req.write(body)
    req.end()
  })

  let result
  try {
    result = JSON.parse(raw)
  } catch {
    throw new Error(`MIGRATION_BAD_RESPONSE: statut ${statusCode}, corps illisible`)
  }
  log('DB migration result:', JSON.stringify({ status: statusCode, ok: result.ok, applied: result.applied?.length ?? 0, failed: result.failedMigration ?? null }))
  if (statusCode !== 200 || result.ok !== true) {
    const code = result.errorCode ?? `HTTP_${statusCode}`
    const stage = result.stage ? ` (étape ${result.stage})` : ''
    const failed = result.failedMigration ? ` [${result.failedMigration}]` : ''
    throw new Error(`MIGRATION_FAILED:${code}${stage}${failed}`)
  }
  return result
}

async function runDesktopExport() {
  log('Desktop export: starting…')
  try {
    const desktop = app.getPath('desktop')
    const d       = new Date()
    const stamp   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const dir     = path.join(desktop, `GarageFlows_Export_${stamp}`)
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
      // Totaux fournis par la couche financière exacte du serveur (centimes) —
      // AUCUN recalcul flottant ici : formatage uniquement.
      const rows = data.invoices.map(inv => ({
        ...inv,
        totalHT:  Number(inv.totalHT ?? 0).toFixed(2),
        totalTTC: Number(inv.totalTTC ?? 0).toFixed(2),
      }))
      fs.writeFileSync(
        path.join(dir, '04_Factures.csv'),
        toCsv(rows, ['number','issueDate','dueDate','clientName','clientEmail','clientPhone','vehicleModel','licensePlate','status','totalHT','totalTTC','taxRate','notes']),
        'utf8'
      )
    }

    // ── Devis ──
    if (data.quotes?.length) {
      // Totaux exacts fournis par le serveur — formatage uniquement.
      const rows = data.quotes.map(q => ({ ...q, totalHT: Number(q.totalHT ?? 0).toFixed(2), totalTTC: Number(q.totalTTC ?? 0).toFixed(2) }))
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

    if (!installSecret) {
      reject(new Error('Secret local indisponible — refus de démarrer le serveur authentifié'))
      return
    }

    const env = {
      ...process.env,
      PORT:              String(PORT),
      // Écoute STRICTEMENT sur la boucle locale : jamais exposé au LAN.
      HOSTNAME:          '127.0.0.1',
      // Origine vue par le NAVIGATEUR (≠ adresse d'écoute ci-dessus) : les URL de
      // rappel NextAuth doivent tomber sur la même origine que la fenêtre, sinon
      // la connexion renvoie hors origine et le garde de navigation la bloque.
      NEXTAUTH_URL:      APP_ORIGIN,
      DATABASE_URL:      dbUrl,
      // Secret unique par installation, partagé entre main.js (mint des JWT) et
      // le serveur Next.js (vérification). Aucun repli codé en dur.
      NEXTAUTH_SECRET:   installSecret,
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
    webPreferences:  { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // __dirname works in both dev and inside the ASAR (Electron handles ASAR paths)
  // — à condition que le fuse GrantFileProtocolExtraPrivileges reste actif, sinon
  // file:// ne sait plus lire dans l'asar (voir scripts/fuse-config.js).
  splashWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) log('[FATAL] splash.html non chargé:', code, desc, url)
  })
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
        sandbox:          true,
        webSecurity:      true,
      },
    })

    // Un échec de chargement ici laissait la fenêtre ENTIÈREMENT vide (peinte par
    // le seul backgroundColor) : l'utilisateur voyait un « écran noir » sans
    // message ni trace dans le log, et ne pouvait ni activer ni comprendre.
    // On journalise et on affiche une page de repli explicite.
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame) return
      log('[FATAL] license.html non chargé:', code, desc, url)
      if (win.isDestroyed()) return
      const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f1629;color:#94a3b8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:10px;text-align:center;padding:24px">
<div style="font-size:40px">⚠</div>
<p style="color:#f87171;font-size:15px;font-weight:700;margin:0">Fenêtre d'activation illisible</p>
<p style="font-size:12px;margin:0">Erreur ${code} : ${desc}</p>
<p style="font-size:11px;color:#475569;margin:0">Réinstallez GarageFlows. Détails : ${LOG_PATH}</p>
</body></html>`
      win.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    })

    win.loadFile(path.join(__dirname, 'license.html'))

    function cleanup() {
      ipcMain.removeAllListeners('license-submit')
      ipcMain.removeAllListeners('license-quit')
    }

    ipcMain.on('license-submit', (event, token) => {
      const payload = verifyEccToken(token)
      if (payload) {
        activeLicense = { token, payload }
        activeDeviceToken = null
        saveLicense(token, payload)
        // Register this device with the server to obtain a device token (device
        // auth). Best-effort — the heartbeat re-tries if the server is offline now.
        activateOnServer().catch(() => {})
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
    title:           'GarageFlows',
    frame:           false,
    titleBarStyle:   'hidden',
    webPreferences: {
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,
      nodeIntegration:    false,
      sandbox:            true,   // durcissement : renderer en bac à sable
      webSecurity:        true,   // same-origin policy active (explicite)
      allowRunningInsecureContent: false,
      spellcheck:         false,
    },
  })

  Menu.setApplicationMenu(null)

  // DevTools : bloqués en production SAUF diagnostic explicite (GF_DEBUG=1) —
  // permet de voir la console (erreur d'hydratation/écran vide) sans affaiblir
  // la sécurité par défaut. Avec GF_DEBUG=1 : ouverture auto + Ctrl+Shift+I.
  const DEBUG = process.env.GF_DEBUG === '1'
  if (!IS_DEV && !DEBUG) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools()
    })
  }
  if (DEBUG) {
    mainWindow.webContents.on('did-frame-finish-load', () => {
      try { mainWindow.webContents.openDevTools({ mode: 'detach' }) } catch { /* ignore */ }
    })
  }

  // Capture les crashs du process de rendu (page blanche / OOM du renderer).
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    reportCrash({ message: `render-process-gone: ${details?.reason || 'unknown'}`, fatal: true, kind: 'renderer' }).catch(() => {})
  })

  // Origine unique côté navigateur — voir APP_ORIGIN en tête de fichier.
  const APP_URL = APP_ORIGIN

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
<p style="color:#f87171;font-size:16px;font-weight:700">Impossible de charger GarageFlows</p>
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
  mainWindow.webContents.on('did-finish-load', () => {
    loadRetries = 0
    // DIAGNOSTIC écran vide : installe dans le renderer un capteur d'erreurs non
    // gérées + un détecteur de page blanche. Si une erreur JS (ex. hydratation)
    // ou une page sans contenu survient, un bandeau VISIBLE affiche le message
    // (plus de « rien qui s'affiche » muet), et l'erreur part dans garageflow.log
    // via console-message. N'affecte pas une page qui rend normalement.
    mainWindow.webContents.executeJavaScript(`(() => {
      if (window.__gfDiag) return; window.__gfDiag = true;
      function overlay(title, msg) {
        try {
          var d = document.getElementById('gf-diag') || document.createElement('div');
          d.id = 'gf-diag';
          d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0f1e;color:#e2e8f0;font:13px system-ui;padding:24px;overflow:auto;white-space:pre-wrap';
          d.textContent = '⚠ ' + title + '\\n\\n' + msg + '\\n\\nLog: ${LOG_PATH.replace(/\\\\/g, '\\\\\\\\')}';
          if (!d.parentNode) document.documentElement.appendChild(d);
        } catch (e) {}
      }
      window.addEventListener('error', function (e) {
        console.error('[gf] uncaught: ' + (e && e.message) + ' @ ' + (e && e.filename) + ':' + (e && e.lineno));
        overlay('Erreur JavaScript (écran vide)', (e && e.message ? e.message : 'inconnue') + '\\n' + (e && e.error && e.error.stack ? e.error.stack : ''));
      });
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason; var m = (r && r.message) ? r.message : String(r);
        console.error('[gf] unhandledrejection: ' + m);
        overlay('Promesse rejetée (écran vide)', m + '\\n' + (r && r.stack ? r.stack : ''));
      });
      // Détecteur de page blanche : 4 s après le chargement, si le <body> n'a
      // aucun contenu visible, on le signale (aide au diagnostic sans DevTools).
      setTimeout(function () {
        try {
          var txt = (document.body && document.body.innerText || '').trim();
          var els = document.body ? document.body.querySelectorAll('*').length : 0;
          if (txt.length === 0 && els < 3 && !document.getElementById('gf-diag')) {
            console.error('[gf] page blanche détectée (body vide) url=' + location.href);
            overlay('Page vide détectée', 'Le contenu ne s\\'est pas affiché (aucun élément rendu).\\nURL: ' + location.href + '\\nOuvrez la console (GF_DEBUG=1) ou envoyez le log ci-dessous.');
          }
        } catch (e) {}
      }, 4000);
    })();`).catch(() => {})
  })

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

  // Fenêtres externes : n'ouvrir dans le navigateur QUE des URLs HTTPS vers des
  // domaines de confiance ; tout le reste est refusé (anti-phishing / protocoles
  // dangereux). Aucune nouvelle BrowserWindow n'est jamais créée par le renderer.
  const ALLOWED_EXTERNAL_HOSTS = new Set([
    'garageflows.fr', 'www.garageflows.fr', 'app.garageflows.fr', 'api.garageflows.fr',
  ])
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
        shell.openExternal(url)
      } else {
        log('[security] window.open refusé :', u.protocol + '//' + u.hostname)
      }
    } catch { /* URL invalide → refus */ }
    return { action: 'deny' }
  })

  // Empêche toute navigation hors de l'app locale (pas de file://, pas d'externe).
  // localOrigin = origine EXACTE attendue (http://127.0.0.1:PORT), dérivée de
  // l'URL réellement chargée. Sans cette définition, isLocalAppUrl(url,
  // localOrigin) levait une ReferenceError AVANT event.preventDefault() : le
  // handler échouait « ouvert » (navigation non bloquée) — le garde de
  // confinement était totalement inopérant.
  const { isLocalAppUrl } = require('./nav-guard')
  const localOrigin = new URL(APP_URL).origin
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalAppUrl(url, localOrigin)) {
      event.preventDefault()
      log('[security] navigation bloquée vers :', String(url).slice(0, 80))
    }
  })
  // will-navigate ne se déclenche PAS sur une redirection serveur (3xx) : sans ce
  // garde, une redirection hors origine locale afficherait une page étrangère avec
  // le pont preload encore attaché. Défense en profondeur (miroir de will-navigate).
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isLocalAppUrl(url, localOrigin)) {
      event.preventDefault()
      log('[security] redirection bloquée vers :', String(url).slice(0, 80))
    }
  })
  // Refuse tout attachement de webview (vecteur d'exécution non prévu).
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

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

  // Update check — serveur central (/api/update/latest) puis replis (voir
  // fetchLatestUpdate). Renvoie un objet homogène incluant sha256, size,
  // mandatory, downloadUrl.
  ipcMain.handle('app:check-updates', async () => {
    try {
      // Chemin unifié (voir fetchLatestUpdate) : serveur central /api/update/latest
      // (avec HWID pour le rollout progressif + manifeste signé Ed25519), puis
      // repli fichier local admin, puis Releases GitHub (SemVer). Le même objet
      // homogène (sha256/size/manifest/mandatory/downloadUrl) alimente à la fois
      // la vérification manuelle et le contrôle périodique, de sorte que
      // app:install-update dispose toujours du manifeste requis à l'installation.
      return await fetchLatestUpdate()
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
  // consent = false par défaut ; decided = l'utilisateur a-t-il déjà choisi ?
  // (le renderer affiche un écran de consentement au 1er lancement si !decided).
  ipcMain.handle('app:crash-consent',     () => ({ consent: crashConsent(), decided: crashConsentDecided() }))
  ipcMain.handle('app:set-crash-consent', (_e, value) => {
    writeSettings({ crashConsent: !!value })
    return { consent: crashConsent(), decided: true }
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
  //
  // `arg` : soit une URL (rétro-compat), soit
  // { url|downloadUrl, sha256, size, fileName, version, manifest }.
  // Sécurité (défense en profondeur) :
  //   1. si une clé de vérification est embarquée, un MANIFESTE signé Ed25519
  //      VALIDE est obligatoire et ses champs font autorité (anti-serveur compromis) ;
  //   2. téléchargement HTTPS REPRENABLE (Range/.part, reprise sur coupure) ;
  //   3. VÉRIFICATION SHA-256 (+ taille) avant tout lancement — fichier altéré refusé.
  ipcMain.handle('app:install-update', async (_event, arg) => {
    const opts       = (arg && typeof arg === 'object') ? arg : { url: arg }
    let url          = opts.url || opts.downloadUrl
    let expectedSha  = String(opts.sha256 || '').trim().toLowerCase() || null
    let expectedSize = Number(opts.size) || null
    const manifest   = opts.manifest || null

    // ── VÉRIFICATION DU MANIFESTE SIGNÉ (Ed25519) — autorité de confiance ──────
    // Un SHA-256 seul (fourni par le même serveur que le binaire) ne protège pas
    // d'un serveur compromis. Si une clé de vérification est embarquée, un
    // manifeste signé VALIDE est OBLIGATOIRE ; ses champs (sha256/size/URL/version)
    // priment sur toute valeur non signée transmise par ailleurs.
    if (updateVerify.signingConfigured()) {
      if (!manifest) {
        log('[install-update] SECURITY: manifeste signé requis — installation refusée')
        return { ok: false, reason: 'Mise à jour non signée — installation refusée pour votre sécurité.' }
      }
      const v = updateVerify.validateManifest(manifest, {
        currentVersion: app.getVersion(),
        channel: UPDATE_CHANNEL,
        platform: process.platform,
        arch: process.arch,
      })
      if (!v.ok) {
        log('[install-update] SECURITY: manifeste invalide —', v.reason)
        reportCrash({ message: 'update_manifest_invalid', fatal: false, kind: 'security' }).catch(() => {})
        return { ok: false, reason: `Mise à jour rejetée : ${v.reason}` }
      }
      // Les valeurs SIGNÉES font autorité (on ignore toute valeur non signée).
      url          = v.manifest.downloadUrl
      expectedSha  = String(v.manifest.sha256 || '').trim().toLowerCase()
      expectedSize = v.manifest.size
      log('[install-update] manifeste signé vérifié — v' + v.manifest.version + ' keyId=' + v.manifest.keyId)
    }
    if (!url || typeof url !== 'string') return { ok: false, reason: 'URL manquante' }

    const { spawn } = require('child_process')
    const tmpDir = require('os').tmpdir()

    // Installateur direct ? (empreinte fournie, extension connue, ou route /downloads/)
    const installerExts = ['.exe', '.msi', '.dmg', '.pkg', '.AppImage', '.deb', '.rpm', '.zip']
    const urlNoQuery = url.toLowerCase().split('?')[0]
    const isDirectFile = !!expectedSha || url.includes('/downloads/') || installerExts.some(ext => urlNoQuery.endsWith(ext))

    if (!isDirectFile) {
      // Pas un installateur direct (ex. page web) — ouverture navigateur.
      shell.openExternal(url)
      return { ok: true, method: 'browser', url }
    }

    // Sauvegarde de sécurité de la base AVANT toute installation
    try { runBackup() } catch (e) { log('[install-update] pre-update backup failed:', e.message) }

    const emit = (pct) => { try { mainWindow?.webContents.send('app:update-progress', pct) } catch (_) {} }

    const fileName = (opts.fileName && String(opts.fileName).replace(/[^0-9A-Za-z._-]/g, '')) ||
      decodeURIComponent((url.split('/').pop() || 'GarageFlows-Setup.exe').split('?')[0]) || 'GarageFlows-Setup.exe'
    const destPath = path.join(tmpDir, fileName)
    const partPath = destPath + '.part'

    // Téléchargement REPRENABLE : requête Range, reprise du .part sur coupure,
    // avec ré-essais (backoff). Le serveur/CDN gère nativement le Range.
    function downloadOnce(startUrl) {
      return new Promise((resolve, reject) => {
        let settled = false
        const doReq = (u, redirects) => {
          if (redirects > 5) { settled = true; return reject(new Error('Trop de redirections')) }
          const mod = u.startsWith('https') ? require('https') : http
          const existing = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0
          const headers = { 'User-Agent': 'GarageFlow/' + app.getVersion() }
          if (existing > 0) headers['Range'] = `bytes=${existing}-`
          let ws = null
          const fail = (err) => {
            if (settled) return
            settled = true
            if (ws) { try { ws.destroy() } catch (_) {} } // stoppe toute écriture en attente
            reject(err)
          }
          const req = mod.get(u, { timeout: 300_000, headers }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume(); doReq(res.headers.location, redirects + 1); return
            }
            let append, total
            if (res.statusCode === 206) {
              append = true
              const cr = res.headers['content-range'] // bytes start-end/total
              total = cr ? parseInt(cr.split('/')[1], 10) : existing + parseInt(res.headers['content-length'] || '0', 10)
            } else if (res.statusCode === 200) {
              append = false // le serveur ignore Range → on repart de zéro
              total = parseInt(res.headers['content-length'] || '0', 10)
            } else {
              res.resume(); return fail(new Error('HTTP ' + res.statusCode))
            }
            let received = append ? existing : 0
            ws = fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' })
            res.on('data', chunk => {
              received += chunk.length
              if (total) emit(Math.min(99, Math.round((received / total) * 100)))
            })
            res.on('error', fail)
            ws.on('error', fail)
            // 'close' (et non 'finish') : le descripteur de fichier est libéré →
            // le rename qui suit est sûr sous Windows.
            ws.on('close', () => { if (!settled) { settled = true; resolve() } })
            res.pipe(ws)
          })
          req.on('error', fail)
          req.on('timeout', () => { req.destroy(); fail(new Error('Délai de téléchargement dépassé')) })
        }
        doReq(startUrl, 0)
      })
    }

    async function download(startUrl, { fresh = false } = {}) {
      if (fresh) { try { fs.unlinkSync(partPath) } catch (_) {} }
      const MAX_ATTEMPTS = 5
      for (let attempt = 1; ; attempt++) {
        try { return await downloadOnce(startUrl) }
        catch (err) {
          if (attempt >= MAX_ATTEMPTS) throw err
          log('[install-update] interruption, reprise (tentative ' + attempt + '):', err.message)
          await new Promise(r => setTimeout(r, 1500 * attempt)) // backoff — conserve le .part
        }
      }
    }

    try {
      emit(0)
      await download(url)

      // Vérification d'intégrité SHA-256 (obligatoire si l'empreinte est fournie).
      if (expectedSha) {
        let actual = await sha256File(partPath)
        if (actual !== expectedSha) {
          // Une passe de re-téléchargement propre au cas où le .part serait corrompu.
          log('[install-update] SHA-256 mismatch, re-téléchargement propre…')
          await download(url, { fresh: true })
          actual = await sha256File(partPath)
        }
        if (actual !== expectedSha) {
          try { fs.unlinkSync(partPath) } catch (_) {}
          log('[install-update] ÉCHEC vérification SHA-256 — installation refusée')
          try { mainWindow?.webContents.send('app:update-error', 'Fichier corrompu (empreinte SHA-256 invalide). Installation annulée.') } catch (_) {}
          return { ok: false, reason: 'Fichier corrompu (empreinte SHA-256 invalide). Installation annulée par sécurité.' }
        }
        log('[install-update] SHA-256 vérifié ✓')
      }

      // Finalise : .part → fichier définitif.
      try { fs.rmSync(destPath, { force: true }) } catch (_) {}
      fs.renameSync(partPath, destPath)
      emit(100)

      // ── VÉRIFICATION CRYPTOGRAPHIQUE OBLIGATOIRE avant toute exécution ───────
      // On n'exécute JAMAIS un binaire téléchargé sans empreinte vérifiée : cela
      // bloque l'attaque « URL malveillante → installeur piégé ». L'empreinte
      // provient du serveur officiel (/api/update/latest), signée côté serveur.
      const actualSha = await new Promise((resolve, reject) => {
        try {
          const h = crypto.createHash('sha256')
          const rs = fs.createReadStream(destPath)
          rs.on('data', d => h.update(d))
          rs.on('end', () => resolve(h.digest('hex')))
          rs.on('error', reject)
        } catch (e) { reject(e) }
      })

      if (expectedSize && fs.existsSync(destPath) && fs.statSync(destPath).size !== expectedSize) {
        try { fs.unlinkSync(destPath) } catch (_) {}
        log('[install-update] SECURITY: size mismatch — refusing to run')
        return { ok: false, reason: 'Taille du fichier inattendue — installation refusée.' }
      }

      if (!expectedSha) {
        // Pas d'empreinte de confiance → on n'exécute pas. Repli navigateur (sûr).
        try { fs.unlinkSync(destPath) } catch (_) {}
        log('[install-update] SECURITY: no SHA-256 provided — refusing to run, opening browser')
        shell.openExternal(url)
        return { ok: true, method: 'browser-unverified', url }
      }

      if (!cp.sha256HexEqual(actualSha, expectedSha)) {
        try { fs.unlinkSync(destPath) } catch (_) {}
        log('[install-update] SECURITY: SHA-256 mismatch — refusing to run', `expected=${expectedSha}`, `actual=${actualSha}`)
        reportCrash({ message: 'update_sha256_mismatch', fatal: false, kind: 'security' }).catch(() => {})
        return { ok: false, reason: 'Signature de la mise à jour invalide — installation refusée pour votre sécurité.' }
      }
      log('[install-update] SHA-256 verified OK:', actualSha)

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
      // A new license key = a new device binding: drop the old device token.
      activeLicense = { token: token.trim(), payload }
      activeDeviceToken = null
      // Save new license to disk (encrypted with HWID)
      saveLicense(token.trim(), payload)
      // Register this device against the new license to obtain a fresh token.
      await activateOnServer()
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
  // ── ARRÊT CONTRÔLÉ si l'épinglage du dossier de données a échoué ────────────
  // Continuer risquerait de créer BD/licence/secret dans un MAUVAIS dossier
  // (perte silencieuse pour les installations existantes). On informe et on sort
  // AVANT toute écriture. Message utilisateur sans chemin sensible inutile.
  if (!USER_DATA_PIN.ok) {
    dialog.showErrorBox(
      'GarageFlows — Erreur de démarrage',
      'Le dossier de données de GarageFlows est inaccessible.\n\n' +
        'Pour protéger vos données existantes (base, licence), l\'application ne peut pas démarrer.\n' +
        'Vérifiez les permissions de votre profil utilisateur Windows, puis relancez GarageFlows.\n\n' +
        `Code technique : USERDATA_PIN_FAILED`
    )
    app.exit(1)
    return
  }

  log('GarageFlows v' + app.getVersion() + ' starting')
  log('userData:', APP_DATA)
  log('IS_DEV:', IS_DEV)
  log('Platform:', process.platform, process.arch)

  // ── Secret local par installation — AVANT toute session/serveur (fail-closed) ─
  try {
    resolveInstallSecret()
  } catch (err) {
    log('FATAL: secret local indisponible')   // ne journalise jamais la valeur
    dialog.showErrorBox(
      'Erreur de sécurité GarageFlows',
      `Impossible d'initialiser le secret local de façon sûre.\n\n${err.message}\n\n` +
        `L'application ne peut pas démarrer en mode authentifié. Vérifiez les permissions du dossier de données, puis réinstallez si nécessaire.`
    )
    app.quit()
    return
  }

  // ── Vérification d'intégrité (anti-altération) ────────────────────────────
  // SÉCURITÉ : la décision se fonde sur app.isPackaged (build RÉEL), JAMAIS sur
  // ELECTRON_DEV (variable d'environnement que l'utilisateur/attaquant contrôle).
  // Un build packagé APPLIQUE toujours « enforce » et ne peut pas être rétrogradé
  // en « audit »/« off » par une variable d'environnement. Hors packagé (dev/test),
  // le mode suit GF_INTEGRITY_MODE (défaut « off »). Voir docs/SECURITY-HARDENING.md.
  {
    const integrity = require('./integrity')
    const { mode, downgradeIgnored } = integrity.resolveIntegrityMode({
      isPackaged: app.isPackaged,
      requested: process.env.GF_INTEGRITY_MODE,
    })
    if (downgradeIgnored) {
      log(`[integrity] GF_INTEGRITY_MODE=${process.env.GF_INTEGRITY_MODE} IGNORÉ en build packagé — « enforce » appliqué`)
    }
    if (mode !== 'off') {
      // Rapport de diagnostic ÉCRIT DANS userData (répertoire MUTABLE — jamais
      // dans resources) : chemins absolus/relatifs, hash attendu/réel, tailles,
      // raison précise. Aucun secret. Best-effort : ne bloque jamais l'app.
      const writeIntegrityReport = (result) => {
        try {
          const reportPath = path.join(app.getPath('userData'), 'integrity-report.json')
          fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            appVersion: app.getVersion(),
            mode,
            resourcesPath: process.resourcesPath,
            present: result.present,
            ok: result.ok,
            checked: result.checked,
            violations: result.violations,
            details: result.details ?? [],
          }, null, 2))
          return reportPath
        } catch (e) { log('[integrity] rapport non écrit:', e && e.message); return null }
      }
      const blockCorrupt = (reportPath) => {
        dialog.showErrorBox(
          'GarageFlows — installation corrompue',
          'Des fichiers essentiels de GarageFlows ont été modifiés, remplacés ou supprimés.\n\n' +
            "Par sécurité, l'application ne peut pas démarrer.\n\n" +
            "Veuillez réinstaller GarageFlows depuis l'installateur officiel." +
            (reportPath ? `\n\nRapport technique : ${reportPath}` : ''),
        )
        app.exit(1)
      }
      try {
        const result = integrity.verify(process.resourcesPath)
        if (!result.present) {
          // Manifeste ABSENT : en « enforce » c'est un échec — sinon un attaquant
          // supprimerait simplement le manifeste pour contourner la vérification.
          // afterPack garantit sa présence dans un build légitime.
          log('[integrity] manifeste absent —', path.join(process.resourcesPath, integrity.MANIFEST_NAME))
          if (mode === 'enforce') { blockCorrupt(writeIntegrityReport(result)); return }
        } else if (result.ok) {
          log('[integrity] OK —', result.checked, 'fichiers critiques vérifiés')
        } else {
          // Diagnostic COMPLET par échec (format exigé) — jamais de secret ici.
          for (const d of result.details ?? []) {
            log(
              `[INTEGRITY][FAIL] file=${d.rel} abs=${d.absPath} reason=${d.reason}` +
              ` expectedSha256=${d.expectedSha256 ?? '-'} actualSha256=${d.actualSha256 ?? '-'}` +
              ` expectedSize=${d.expectedSize ?? '-'} actualSize=${d.actualSize ?? '-'}`,
            )
          }
          log('[integrity] ALTÉRATION détectée:', result.violations.join(', '))
          if (mode === 'enforce') { blockCorrupt(writeIntegrityReport(result)); return }
        }
        // Anti-débogueur : bloquant uniquement si explicitement activé (évite les
        // faux positifs) via GF_ANTIDEBUG=1.
        if (integrity.detectDebugger()) {
          log('[integrity] débogueur/inspecteur détecté')
          if (mode === 'enforce' && process.env.GF_ANTIDEBUG === '1') {
            dialog.showErrorBox('GarageFlows', "Un outil de débogage a été détecté. Fermeture par sécurité.")
            app.exit(1)
            return
          }
        }
      } catch (e) {
        // En « enforce », une ERREUR de vérification ne doit PAS être avalée en
        // silence : un attaquant pourrait provoquer l'exception pour contourner.
        log('[integrity] erreur de vérification:', e && e.message)
        if (mode === 'enforce') { blockCorrupt(); return }
      }
    }
  }

  checkDebugger()
  registerCrashHandlers()
  checkClockIntegrity()
  currentModules = loadEntitlements()
  setupIPC()
  createSplash()
  setupDatabase()

  // ── SAUVEGARDE PRÉ-MIGRATION (AVANT le serveur, AVANT toute migration) ─────
  // La base n'est ouverte par aucun processus ici → copie (db + -wal + -shm)
  // COHÉRENTE, puis VÉRIFIÉE (en-tête SQLite, taille). Une sauvegarde invalide
  // BLOQUE le démarrage : aucune migration ne s'exécutera sans copie sûre.
  const { createPreMigrationBackup } = require('./pre-migration-backup')
  const PRE_MIGRATION_DIR = path.join(BAK_DIR, 'pre-migration')
  const preBackup = createPreMigrationBackup(DB_PATH, PRE_MIGRATION_DIR)
  if (!preBackup.ok) {
    log('[FATAL] sauvegarde pré-migration invalide:', preBackup.error)
    dialog.showErrorBox(
      'GarageFlows — Sauvegarde impossible',
      'La sauvegarde de sécurité de votre base de données n\'a pas pu être créée ou vérifiée.\n\n' +
        'Par précaution, GarageFlows ne démarre pas (aucune migration ne sera tentée sans sauvegarde valide).\n' +
        'Vérifiez l\'espace disque et les permissions, puis relancez l\'application.\n\n' +
        'Code technique : PRE_MIGRATION_BACKUP_FAILED'
    )
    app.exit(1)
    return
  }
  if (preBackup.warning) log('[backup] avertissement:', preBackup.warning)
  if (!preBackup.skipped) log('Sauvegarde pré-migration OK:', preBackup.path)

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
      'Erreur de démarrage GarageFlows',
      `Impossible de démarrer le serveur.\n\n${err.message}\n\nRéinstallez l'application.`
    )
    app.quit()
    return
  }

  // ── Migrations SQLite via l'API interne — FAIL-CLOSED ─────────────────────
  // Le résultat COMPLET est contrôlé (statut HTTP, JSON, ok). En cas d'échec :
  // AUCUNE fenêtre principale, message utilisateur avec référence d'erreur et
  // accès au dossier de sauvegarde, sortie avec code non nul. Une erreur de
  // migration destructive n'est JAMAIS « non fatale ».
  try {
    await runInternalMigration()
  } catch (err) {
    log('[FATAL] migration échouée:', err.message)
    const backupInfo = preBackup.skipped
      ? 'Aucune donnée antérieure (première installation).'
      : `Une sauvegarde intacte de vos données a été créée AVANT toute modification :\n${preBackup.path}`
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'GarageFlows — Migration de la base interrompue',
      message: 'La mise à jour de la base de données a échoué. Vos données n\'ont pas été perdues.',
      detail:
        `${backupInfo}\n\n` +
        'GarageFlows va se fermer par sécurité (aucune donnée ne sera modifiée en l\'état).\n' +
        'Relancez l\'application ; si le problème persiste, contactez le support avec la référence ci-dessous.\n\n' +
        `Référence : ${String(err.message).slice(0, 160)}`,
      buttons: preBackup.skipped ? ['Fermer'] : ['Ouvrir le dossier de sauvegarde', 'Fermer'],
      defaultId: preBackup.skipped ? 0 : 1,
      noLink: true,
    }).catch(() => ({ response: -1 }))
    if (!preBackup.skipped && response === 0) {
      try { await shell.openPath(PRE_MIGRATION_DIR) } catch (_e) { log('[backup] ouverture dossier impossible:', _e.message) }
    }
    app.exit(1)
    return
  }

  // ── Session MÉCANICIEN (mono-poste) ─────────────────────────────────────
  // Une clé mécanicien ouvre l'espace /mechanic : on complète la session locale
  // (gid + mid) une fois la base migrée. Sans cela, les API mécanicien refusent
  // l'accès (fail-closed).
  if (!IS_DEV && activeLicense?.payload?.typ === 'mechanic') {
    await establishMechanicSession().catch(err => log('[mechanic] session error:', err.message))
  }

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

  // ── Vérification des mises à jour : au démarrage puis toutes les heures ────
  startPeriodicUpdateCheck()
})

app.on('window-all-closed', () => {
  if (backupTimer)       { clearInterval(backupTimer);         backupTimer       = null }
  if (licenseTimer)      { clearTimeout(licenseTimer);         licenseTimer      = null }
  if (onlineCheckTimer)  { clearInterval(onlineCheckTimer);    onlineCheckTimer  = null }
  if (updateTimer)       { clearInterval(updateTimer);         updateTimer       = null }
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

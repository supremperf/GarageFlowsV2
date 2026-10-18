'use strict'

const { activateAtAuthority } = require('./activation-policy')
const { assertLicenseTrust } = require('./license-trust')

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
const { evaluerGraceHorsLigne } = require('./grace-hors-ligne')
const { evaluerSauvegardes, formulerAge } = require('./sauvegarde-en-souffrance')
const { evaluerEcheanceExport } = require('./echeance-export')
const crypto  = require('crypto')
const os      = require('os')
const { resolveMainSecret, resolveSmtpCipherKey, loadOrCreateInstallSecret } = require('./secret')
const { sign: signState, verify: verifyState } = require('./signed-state')
const { decodeDotenvValue } = require('./dotenv-value')
const { activationReport } = require('./activation-report')
const {
  shouldAttemptActivation, afterRefusal, cleared, humanDelay,
} = require('./activation-backoff')

// Silence EPIPE on stdout/stderr so packaged app never crashes when no terminal is attached
try { process.stdout.on('error', () => {}) } catch (_) {}
try { process.stderr.on('error', () => {}) } catch (_) {}

// ── Load .env for dev mode (Next.js reads it automatically, Electron doesn't) ─
;(function loadDotEnv() {
  // Installed applications use only userData secrets and bundled defaults, never a project .env.
  if (app.isPackaged) return
  const root    = path.join(__dirname, '..')
  const envFile = path.join(root, '.env')

  // Auto-create .env if missing — prevents "blue screen" on fresh clone in dev.
  // Création EXCLUSIVE ('wx') : aucun test d'existence préalable (course
  // check-then-use) et un .env apparu entre-temps n'est jamais écrasé.
  try {
    let contenu
    try { contenu = fs.readFileSync(path.join(root, '.env.example'), 'utf8') }
    catch (_) {
      // Aucun secret codé en dur : NEXTAUTH_SECRET est résolu par installation
      // (voir resolveInstallSecret() dans app.whenReady) et injecté à l'exécution.
      contenu = [
        'DATABASE_URL="file:./dev.db"',
        'NEXTAUTH_URL="http://localhost:3000"',
        '',
      ].join('\n')
    }
    fs.writeFileSync(envFile, contenu, { encoding: 'utf8', flag: 'wx' })
  } catch (_) { /* .env déjà présent ou illisible : il est lu ci-dessous */ }

  try {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      // Same literal quoting contract as config/Next; never eval or expand env.
      const val = decodeDotenvValue(line.slice(eq + 1).trim())
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
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXKiGHY7aFcS/uMbVz2hP2FptYJxH',
  'cAmacvNlLuzalHkssxU7kNZcY0T4UD1ilFOecW+d/YvnoDlRMxS5uTjWDA==',
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
/**
 * Vrai quand c'est NOUS qui arrêtons le serveur (fermeture, mise à jour).
 *
 * Sans cette distinction, l'annonce de panne se déclencherait aussi à chaque
 * fermeture normale — et un message d'erreur qui apparaît quand tout va bien
 * finit par être ignoré quand tout va mal.
 */
let arretVoulu        = false
let backupTimer       = null
let licenseTimer      = null    // periodic revocation check (adaptive interval)
let licenseBlocked    = false   // true while access is blocked (revoked/suspended/tampered)
let lastLicenseBlock  = null    // { status, reason } du dernier blocage — pour ré-afficher l'overlay
let licenseCheckStarted = false // guards against starting the poll loop twice
let activeLicense     = null   // { token, payload } — set after validation
let activeDeviceToken = null   // device token issued by the server on activation (device auth)
let desktopExportTimer = null
let onlineCheckTimer  = null   // periodic internet connectivity check
let installSecret     = null   // secret par installation (session JWT + NEXTAUTH_SECRET serveur)
let smtpCipherKey     = null   // clé de chiffrement AU REPOS des identifiants SMTP
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

// Décision du battement de licence — module PUR (voir electron/heartbeat-policy.js).
// Règle de sécurité : seul un « active » explicite de l'autorité DISTANTE lève un
// blocage ; le repli local n'est jamais une autorité de réactivation (GF-FINAL-001).
const { heartbeatDecision } = require('./heartbeat-policy')

// ── App-update helpers ────────────────────────────────────────────────────────

// GET JSON avec timeout + suivi de redirections (jamais de throw → resolve(null)).
function httpGetJson(url, timeoutMs = 6000, redirects = 0) {
  return new Promise(resolve => {
    try {
      if (redirects > 5) return resolve(null)
      const mod = url.startsWith('https') ? require('https') : http
      const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'GarageFlow/' + app.getVersion() } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          // ── Une redirection ne doit pas AFFAIBLIR le transport ────────────────
          // L'en-tête `Location` était suivi tel quel. Deux conséquences :
          //
          //  · une redirection RELATIVE (« /api/update/latest-v2 ») n'était pas
          //    résolue contre l'URL d'origine ; la chaîne partait au module
          //    `http`, qui refusait, et la vérification de mise à jour échouait
          //    en silence ;
          //  · une redirection de `https:` vers `http:` était acceptée. La
          //    métadonnée — dont l'URL de téléchargement et l'empreinte —
          //    provenait alors d'une source en clair, modifiable en route. La
          //    signature du manifeste protège encore les OCTETS installés quand
          //    elle est configurée, mais elle ne protège rien lorsqu'elle ne
          //    l'est pas, et un manifeste retiré par un tiers suffit à priver
          //    durablement le poste de mises à jour.
          let suivante = null
          try { suivante = new URL(res.headers.location, url) } catch (_) {}
          const protocoleAdmis = suivante && (suivante.protocol === 'https:' || suivante.protocol === 'http:')
          const retrograde = url.startsWith('https') && suivante?.protocol !== 'https:'
          if (!protocoleAdmis || retrograde) {
            log('[update] redirection refusée:', String(res.headers.location).slice(0, 120))
            return resolve(null)
          }
          resolve(httpGetJson(suivante.toString(), timeoutMs, redirects + 1))
          return
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

// Réduit une chaîne à un NOM de fichier, jamais à un chemin (update-verify.js).
const nomFichierSur = updateVerify.nomFichierInstallateur

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

/**
 * Annote une mise à jour avec son caractère RÉELLEMENT installable.
 *
 * Quand une clé de vérification est embarquée, `app:install-update` exige un
 * manifeste signé. Deux des trois sources n'en fournissaient aucun : l'interface
 * proposait donc un bouton « Mettre à jour » qui échouait systématiquement sur
 * « Mise à jour non signée ». On le dit maintenant AVANT, et l'écran propose le
 * téléchargement manuel au lieu d'une promesse intenable (GF31-AUD-042).
 */
function annoterInstallabilite(info) {
  if (!info || !info.hasUpdate) return info
  const signatureExigee = updateVerify.signingConfigured()

  // ── Palier obligatoire annoncé par la source ────────────────────────────────
  // `minVersion` était collecté par `fetchLatestUpdateBrut` puis ignoré partout.
  // La garde qui compte est dans `update-verify.js` — elle porte sur le
  // manifeste SIGNÉ, seule autorité. Celle-ci est en amont et sert l'écran :
  // proposer un bouton « Mettre à jour » que le processus principal refusera
  // ensuite, c'est promettre puis se dédire.
  const palierManquant = Boolean(
    info.minVersion && semver.isNewer(info.minVersion, info.currentVersion),
  )

  const installable = palierManquant ? false : (!signatureExigee || Boolean(info.manifest))
  const motif = palierManquant
    ? `Cette mise à jour exige la version ${info.minVersion} au minimum : `
      + `installez d'abord la version ${info.minVersion}, puis relancez la mise à jour.`
    : "Cette mise à jour n'est pas accompagnée d'un manifeste signé : "
      + 'elle ne peut pas être installée automatiquement. Téléchargez-la et '
      + 'installez-la manuellement, ou demandez à votre éditeur une publication signée.'

  return {
    ...info,
    signatureExigee,
    installable,
    unsignedReason: installable ? null : motif,
  }
}

// Interroge le serveur central et renvoie un objet de mise à jour homogène.
// Ordre : serveur central (/api/update/latest) → fichier local admin →
// Releases GitHub (repli, non vérifiable). Si le serveur central répond
// « pas de maj », on s'y fie (pas de repli GitHub qui ferait un faux positif).
async function fetchLatestUpdate() {
  return annoterInstallabilite(await fetchLatestUpdateBrut())
}

async function fetchLatestUpdateBrut() {
  const currentVersion = app.getVersion()
  // Une source a-t-elle RÉPONDU ? Sans cette trace, « aucune source joignable »
  // et « vous êtes à jour » rendaient le même objet (GF-024).
  let sourceRepondu = false

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
    // Le fichier existe et se lit : c'est une réponse, même s'il n'annonce
    // aucune version plus récente.
    sourceRepondu = true
    // Comparaison SEMVER, jamais une inégalité de chaînes : `!==` proposait
    // comme « mise à jour » toute version DIFFÉRENTE, donc aussi une version
    // ANTÉRIEURE republiée par erreur dans la Zone Administrateur — un retour en
    // arrière présenté à l'utilisateur comme une nouveauté. Le chemin central
    // (`semver.isNewer`) et le repli GitHub le faisaient déjà correctement ;
    // seule la publication locale ne le faisait pas.
    if (localUpdate?.hasUpdate && semver.isNewer(localUpdate.latestVersion, currentVersion)) {
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
        // Manifeste signé publié EN MÊME TEMPS que l'installeur par la Zone
        // Administrateur. Sans lui, `app:install-update` refuse l'installation
        // dès qu'une clé de vérification est embarquée : la publication locale
        // était donc morte de bout en bout (GF31-AUD-042).
        manifest:      localUpdate.manifest ?? null,
        source:        'local-admin',
      }
    }
  } catch { /* pas de fichier local — ok */ }

  // Repli : Releases GitHub (pas d'empreinte → non vérifiable, ouverture navigateur).
  const gh = await httpGetJson('https://api.github.com/repos/garageflow/garageflow/releases/latest', 8000)
  if (gh !== null) sourceRepondu = true
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

  // ── « Pas de mise à jour » ≠ « je n'ai pas pu regarder » (GF-024) ──────────
  // Ce retour était le MÊME dans les deux cas, et l'écran affichait un bandeau
  // vert « Vous utilisez la dernière version » alors qu'aucune source n'avait
  // répondu. `httpGetJson` ne lève jamais (elle résout `null` sur erreur, sur
  // délai dépassé et sur JSON illisible) : le `catch` du gestionnaire IPC était
  // donc mort, et personne ne pouvait distinguer les deux situations.
  //
  // `checked` dit si une source a réellement répondu. Les retours de succès
  // plus haut ne le portent pas — leur comportement est inchangé.
  if (!sourceRepondu) {
    return {
      hasUpdate: false, currentVersion, checked: false,
      error: 'Aucune source de mise à jour joignable.',
    }
  }
  return { hasUpdate: false, currentVersion, checked: true }
}

// ── Mémoire des tentatives de mise à jour ─────────────────────────────────────
//
// `lastNotifiedUpdate` ne vivait qu'en mémoire. Une installation qui échoue —
// l'utilisateur annule l'assistant, l'antivirus bloque, l'installateur se
// termine sans rien faire — laissait le poste rouvrir sur la MÊME version, et
// la proposition revenait au démarrage suivant, identique. Le garagiste
// racceptait, l'installateur retéléchargeait deux cents mégaoctets, échouait
// pareil. Rien n'apprenait de la tentative précédente.
//
// On garde donc une trace : quelle version a été lancée, et quand. Tant que le
// poste n'a pas changé de version et que la tentative est fraîche, on se tait —
// SAUF pour une mise à jour obligatoire, qu'on n'a pas le droit de masquer.
const UPDATE_TRY_PATH = () => path.join(APP_DATA, 'gf_update_tentative.json')
/** Une tentative reste « fraîche » pendant six heures. */
const UPDATE_TRY_TTL_MS = 6 * 60 * 60 * 1_000

function lireTentativeMaj() {
  try {
    const v = JSON.parse(fs.readFileSync(UPDATE_TRY_PATH(), 'utf8'))
    if (typeof v?.version === 'string' && Number.isFinite(v?.ts)) return v
  } catch (_) { /* absente ou illisible : aucune tentative connue */ }
  return null
}

function ecrireTentativeMaj(version) {
  try {
    fs.mkdirSync(APP_DATA, { recursive: true })
    fs.writeFileSync(UPDATE_TRY_PATH(), JSON.stringify({ version, ts: Date.now() }), 'utf8')
  } catch (e) { log('[update] tentative non mémorisée:', e.message) }
}

function oublierTentativeMaj() {
  try { fs.rmSync(UPDATE_TRY_PATH(), { force: true }) } catch (_) {}
}

/** Faut-il taire cette proposition parce qu'on vient déjà de l'essayer ? */
function tentativeRecente(info) {
  if (!info || info.mandatory) return false
  const t = lireTentativeMaj()
  if (!t) return false
  // Le poste tourne enfin sur la version visée (ou plus récente) : la tentative
  // a abouti, la mémoire n'a plus d'objet.
  if (!semver.isNewer(t.version, app.getVersion())) { oublierTentativeMaj(); return false }
  const age = Date.now() - t.ts
  if (age < 0 || age > UPDATE_TRY_TTL_MS) { oublierTentativeMaj(); return false }
  return t.version === info.latestVersion
}

/**
 * Retire les installateurs abandonnés dans `%TEMP%\gf-update`.
 *
 * Chaque tentative laissait un exécutable de plusieurs centaines de mégaoctets,
 * que rien ne supprimait : on ne peut pas effacer un installateur pendant qu'il
 * s'exécute, et l'application est fermée juste après l'avoir lancé. Sur un
 * poste qui a vu passer quelques mises à jour, le dossier temporaire se remplit
 * de gigaoctets — et un disque plein est précisément ce qui fait échouer la
 * mise à jour suivante.
 */
function purgerTelechargementsMaj(ageMaxMs = 7 * 24 * 60 * 60 * 1_000) {
  const dossier = path.join(require('os').tmpdir(), 'gf-update')
  let retires = 0
  try {
    for (const nom of fs.readdirSync(dossier)) {
      const p = path.join(dossier, nom)
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > ageMaxMs) { fs.rmSync(p, { force: true }); retires++ }
      } catch (_) { /* fichier verrouillé ou disparu : on passe */ }
    }
  } catch (_) { /* dossier absent : rien à purger */ }
  if (retires) log(`[update] ${retires} téléchargement(s) abandonné(s) supprimé(s)`)
  return retires
}

// Contrôle au démarrage (~25 s) puis toutes les heures ; notifie le renderer.
function startPeriodicUpdateCheck() {
  const runCheck = async () => {
    try {
      const info = await fetchLatestUpdate()
      if (info?.hasUpdate && info.latestVersion && info.latestVersion !== lastNotifiedUpdate) {
        if (tentativeRecente(info)) {
          log('[update] proposition tue — version', info.latestVersion, 'déjà tentée récemment')
          return
        }
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

  // Clé de chiffrement AU REPOS des identifiants SMTP. Sans elle, /api/email
  // refuse d'enregistrer un mot de passe (503) — l'envoi d'e-mails était donc
  // inconfigurable sur le poste (GF31-AUD-012). Stable entre démarrages : une
  // clé régénérée rendrait les mots de passe déjà stockés indéchiffrables.
  const smtp = resolveSmtpCipherKey(APP_DATA, process.env.GF_SMTP_CIPHER_KEY)
  smtpCipherKey = smtp.key
  log(`Clé de chiffrement SMTP prête (source: ${smtp.source})`)   // jamais la valeur
}

// ── Online check state ────────────────────────────────────────────────────────
const ONLINE_CHECK_FILE    = () => path.join(APP_DATA, 'last_online.json')
// État de BLOCAGE licence persisté (revoked/suspended/tampered), signé comme
// last_online.json (HMAC lié à l'installation + hwid). Sans lui, un simple
// redémarrage hors ligne repartait débloqué : licenseBlocked n'était qu'une
// variable en mémoire (GF-FINAL-001). Limite honnête identique à
// electron/signed-state.js : supprimer le fichier efface le drapeau — c'est le
// miroir en base locale (/api/internal/license-status) qui tient la seconde
// couche, et l'autorité distante qui reste la source de vérité.
const LICENSE_BLOCK_FILE   = () => path.join(APP_DATA, 'license_block.json')
const GRACE_PERIOD_MS      = 48 * 60 * 60 * 1_000   // 48 hours
const LOCK_PERIOD_MS       = 72 * 60 * 60 * 1_000   // 72 hours (lock after grace)
// La sonde de connectivité vise désormais l'AUTORITÉ de licence (LICENSE_SERVER)
// et non plus une URL générique — voir checkInternetConnectivity().

// ── Logging ───────────────────────────────────────────────────────────────────

/**
 * Taille au-delà de laquelle le journal est basculé.
 *
 * Il n'avait AUCUNE borne. Le poste écrit à chaque vérification de licence
 * (toutes les 2 minutes), à chaque battement de synchronisation, et relaie en
 * plus la sortie du serveur Next ligne par ligne. Sur une installation qui
 * tourne depuis deux ans, `garageflow.log` atteint des centaines de mégaoctets :
 * il remplit le disque du poste, et `app:open-logs` ouvre un fichier que le
 * Bloc-notes ne sait plus afficher.
 */
const LOG_MAX_OCTETS = 5 * 1024 * 1024
/** On ne consulte pas la taille à chaque ligne : ce serait un `stat` par log. */
const LOG_PAS_CONTROLE = 256 * 1024
// Amorcé au seuil : le tout premier `log()` contrôle la taille. Sans cela, un
// poste qui redémarre avec un journal déjà énorme écrirait encore 256 Ko dedans
// avant qu'on s'en aperçoive — et un poste qu'on redémarre souvent ne
// basculerait jamais.
let octetsDepuisControle = LOG_PAS_CONTROLE

/**
 * Bascule `garageflow.log` en `garageflow.log.1` quand il devient trop gros.
 *
 * UN seul fichier précédent est conservé : deux générations de 5 Mo bornent le
 * journal à 10 Mo, ce qui laisse largement de quoi comprendre un incident sans
 * jamais devenir un problème de place.
 */
function faireTournerJournal() {
  try {
    const taille = fs.statSync(LOG_PATH).size
    if (taille < LOG_MAX_OCTETS) return
    try { fs.rmSync(LOG_PATH + '.1', { force: true }) } catch (_) {}
    fs.renameSync(LOG_PATH, LOG_PATH + '.1')
  } catch (_) { /* journal absent ou verrouillé : rien à basculer */ }
}

function log(...args) {
  // Upstream errors/redirects are untrusted. Never persist signed URLs or raw
  // credentials, and never let a remote value create a forged log/terminal line.
  const message = args.map(value => cp.redactSensitive(value)).join(' ')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
  const line = `[${new Date().toISOString()}] ${message}\n`
  try { process.stdout.write(line) } catch (_) {}   // EPIPE-safe: no terminal in packaged app
  try {
    octetsDepuisControle += Buffer.byteLength(line)
    if (octetsDepuisControle >= LOG_PAS_CONTROLE) {
      octetsDepuisControle = 0
      faireTournerJournal()
    }
    fs.appendFileSync(LOG_PATH, line)
  } catch (_) {}
}

/**
 * Rend les derniers octets du journal SANS le charger en entier.
 *
 * `readFileSync(...).slice(-4000)` lisait tout le fichier pour n'en garder que
 * quatre kilo-octets — au moment précis où l'on prépare un rapport d'incident,
 * c'est-à-dire quand la mémoire est déjà le problème.
 */
function lireQueueJournal(octets) {
  let fd = null
  try {
    fd = fs.openSync(LOG_PATH, 'r')
    const taille = fs.fstatSync(fd).size
    const depuis = Math.max(0, taille - octets)
    const tampon = Buffer.alloc(Math.min(octets, taille))
    const lus = fs.readSync(fd, tampon, 0, tampon.length, depuis)
    const texte = tampon.subarray(0, lus).toString('utf8')
    // Une lecture qui commence au milieu du fichier peut couper un caractère
    // accentué en deux. On repart de la première ligne entière : le rapport
    // d'incident perd une ligne tronquée et gagne un texte lisible.
    if (depuis === 0) return texte
    const coupure = texte.indexOf('\n')
    return coupure === -1 ? texte : texte.slice(coupure + 1)
  } catch (_) {
    return null
  } finally {
    if (fd !== null) { try { fs.closeSync(fd) } catch (_) {} }
  }
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

// ── Sondes matérielles : interrogées UNE fois par exécution ───────────────────
//
// `wmic diskdrive get serialnumber` coûte 63 ms mesurés sur un poste Windows 10
// (5 appels : 81, 59, 59, 59, 58 ms), et `execSync` GÈLE le processus principal
// pendant ce temps : pas de redessin de fenêtre, pas d'IPC servi. La
// vérification de licence a lieu toutes les 2 minutes — toutes les 20 secondes
// quand un accès est bloqué — et l'empreinte est calculée plusieurs fois par
// vérification. Soit ~46 s de gel par jour en cadence normale, ~4,6 min en
// cadence bloquée. La V1 était pire encore : `collectHwidFieldsV1` appelait
// `getDiskSerial()` DEUX fois dans la même expression, plus une requête au
// registre.
//
// Mais le coût n'est pas l'argument décisif : c'est la STABILITÉ. Le disque ne
// change pas pendant qu'un logiciel tourne ; `wmic`, lui, peut échouer
// ponctuellement (service WMI occupé, dépôt WMI en réparation — et l'outil est
// retiré des versions récentes de Windows). UNE seule sonde ratée en cours de
// session remplaçait le numéro de série par « unknown-disk », donc changeait
// l'empreinte, donc :
//   · `hwidMatches` refusait la licence — la comparaison y est exacte ;
//   · la licence stockée devenait indéchiffrable, sa clé étant dérivée du HWID.
// Le garage se retrouvait dehors à cause d'un sous-processus qui a hoqueté.
//
// Une valeur par exécution : l'empreinte ne bouge plus en cours de session.
// L'algorithme lui-même est inchangé — mêmes champs, même sel, mêmes vecteurs
// (tests/fixtures/hwid-v1-vectors.json).
let sondeDisque    = null
let sondeMachineId = null

function getDiskSerial() {
  if (sondeDisque !== null) return sondeDisque
  sondeDisque = lireSerieDisque()
  return sondeDisque
}

function lireSerieDisque() {
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

/**
 * Empreinte v0 — calculée UNE fois, pour la même raison que les sondes.
 *
 * Le choix de la MAC (« première interface non-loopback ») dépend de l'ordre
 * rendu par `os.networkInterfaces()`. Un adaptateur qui apparaît en cours de
 * session — VPN qui se connecte, clé Wi-Fi branchée, carte virtuelle d'une
 * machine invitée — pouvait donc changer l'empreinte SANS que le poste ait
 * changé, et refermer le logiciel sur son propriétaire.
 */
let empreinteV0 = null
function getHwid() {
  if (empreinteV0 !== null) return empreinteV0
  empreinteV0 = calculerHwid()
  return empreinteV0
}

function calculerHwid() {
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

// ── HWID V1 — empreinte CANONIQUE (AUD-036) ───────────────────────────────────
// UNE SEULE autorité collecte les champs : le client (ici). Le keygen/backend ne
// reconstruisent plus l'identité — ils LIENT la valeur produite ici (voir
// docs/security/HWID_SPEC_V1.md + scripts/hwid_v1.py + src/lib/license/hwid-v1.ts).
// L'algorithme ci-dessous DOIT rester octet-pour-octet identique à hwid-v1.ts
// (prouvé par tests/fixtures/hwid-v1-vectors.json). Ne pas le modifier isolément.

/** Identifiant machine stable, par OS. Vide si indisponible (l'empreinte reste définie). */
function getMachineId() {
  if (sondeMachineId !== null) return sondeMachineId
  sondeMachineId = lireMachineId()
  return sondeMachineId
}

function lireMachineId() {
  const { execSync } = require('child_process')
  try {
    if (os.platform() === 'win32') {
      // MachineGuid : identifiant d'installation Windows, stable, non lié au NIC.
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { timeout: 3000 },
      ).toString()
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
      if (m) return m[1].trim()
    } else if (os.platform() === 'darwin') {
      const out = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | grep IOPlatformUUID',
        { timeout: 3000 },
      ).toString()
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (m) return m[1].trim()
    } else {
      // Linux : /etc/machine-id (ou /var/lib/dbus/machine-id).
      for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const v = fs.readFileSync(p, 'utf8').trim()
          if (v) return v
        } catch { /* essai suivant */ }
      }
    }
  } catch { /* ignore — champ vide */ }
  return ''
}

/** Normalisation d'un champ — IDENTIQUE à normalizeHwidField (hwid-v1.ts / hwid_v1.py). */
function normalizeHwidFieldV1(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Collecte les champs matériels canoniques (source unique côté client). */
function collectHwidFieldsV1() {
  // MAC : première interface non-loopback stable (même sélection que getHwid v0).
  let mac = ''
  outer: for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const net of (ifaces ?? [])) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac
        break outer
      }
    }
  }
  // Une seule lecture : l'expression appelait `getDiskSerial()` deux fois, donc
  // sondait le disque deux fois par empreinte — et, avant la mémorisation,
  // pouvait obtenir deux réponses différentes dans la même expression.
  const serie = getDiskSerial()
  return {
    cpu:        os.cpus()[0]?.model ?? '',
    diskSerial: serie === 'unknown-disk' ? '' : serie,
    mac,
    machineId:  getMachineId(),
    platform:   `${os.platform()}-${os.arch()}`,
  }
}

// Ordre canonique FIXE (trié) — NE JAMAIS réordonner (changerait toutes les empreintes).
const HWID_V1_CANONICAL_KEYS = ['cpu', 'diskSerial', 'mac', 'machineId', 'platform']

/** Empreinte V1 canonique « HWID1-<sha256hex> » (== hwidV1() TS / hwid_v1.py). */
let empreinteV1 = null
function getHwidV1() {
  if (empreinteV1 !== null) return empreinteV1
  empreinteV1 = calculerHwidV1()
  return empreinteV1
}

function calculerHwidV1() {
  const fields = collectHwidFieldsV1()
  const lines = HWID_V1_CANONICAL_KEYS.map((k) => `${k}=${normalizeHwidFieldV1(fields[k])}`)
  const serialized = 'GF-HWID-V1\n' + lines.join('\n')
  const digest = crypto.createHash('sha256').update(Buffer.from(serialized, 'utf8')).digest('hex')
  return `HWID1-${digest}`
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
  const verificationKey = assertLicenseTrust(PUBLIC_KEY_PEM)
  try {
    if (typeof token !== 'string' || !token.startsWith('GF2.')) return null

    const parts = token.trim().split('.')
    if (parts.length !== 4) return null

    const [, headerB64, payloadB64, sigB64] = parts

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
    if (!verifier.verify(verificationKey, sig)) {
      // Ce rejet était TOTALEMENT muet : la seule trace était « No valid license »
      // plus haut, indiscernable d'une absence de licence. Diagnostiquer une clé
      // embarquée divergente demandait alors de désosser le binaire.
      // On journalise une empreinte TRONQUÉE de la clé de vérification (une clé
      // publique n'est pas un secret, mais on n'en écrit jamais le corps complet).
      log('Signature de licence non vérifiée. Empreinte clé embarquée:', publicKeyFingerprint())
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
  const hex64 = /^[0-9a-f]{64}$/
  const v1re  = /^hwid1-[0-9a-f]{64}$/

  // La VERSION LIÉE commande la version calculée. Le serveur accepte les deux
  // formats (`verify.ts` : `HWID_V1_RE`), et V1 est documentée comme canonique
  // — mais le client ne reconnaissait que le format v0 (64 hex nus) et
  // `getHwidV1()` n'avait AUCUN appelant. Une licence liée avec l'empreinte
  // canonique verrouillait donc définitivement l'utilisateur hors de son
  // logiciel, alors même que le serveur la déclarait valide (GF31-AUD-055).
  const estV1 = v1re.test(a)
  const b = estV1
    ? String(getHwidV1()).trim().toLowerCase()
    : String(current).trim().toLowerCase()

  if (estV1) {
    if (!v1re.test(b)) return false
  } else if (!hex64.test(a) || !hex64.test(b)) {
    return false
  }

  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

// ── License storage (AES-256-GCM, key derived from HWID via PBKDF2) ──────────

const LIC_SALT     = 'GarageFlow-License-Storage-Salt-v2'
const DB_MAC_SALT  = 'GarageFlow-DB-MAC-Salt-v1'
/** Secret d'installation mêlé au HWID pour le MAC de base (GF31-AUD-056). */
const DB_MAC_SECRET_FILE = 'gf_db_mac.key'

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
  // Le secret ne se dérive plus du SEUL HWID.
  //
  // HWID + sel en dur + algorithme public = un secret que n'importe quel
  // processus tournant sur la machine pouvait RECALCULER, donc forger un MAC
  // valide et réécrire l'état d'une licence sans que le contrôle d'intégrité
  // n'y voie rien. On y mêle donc un secret d'installation aléatoire, généré
  // une fois et conservé dans `userData` avec les mêmes garanties que le secret
  // de session (256 bits, écriture atomique, permissions restreintes, jamais
  // journalisé) — même mécanisme que la clé de chiffrement SMTP (GF31-AUD-056).
  //
  // Portée HONNÊTE de cette correction : elle élève le coût de l'attaque de
  // « recalculer une fonction publique » à « lire un fichier protégé de
  // userData ». Un adversaire disposant déjà des droits d'administration
  // locaux reste capable de le lire — s'en prémunir exigerait un scellement
  // ASYMÉTRIQUE par l'éditeur, hors du périmètre de cette correction.
  const hwid = getHwid()
  let installSecret = ''
  try {
    installSecret = loadOrCreateInstallSecret(app.getPath('userData'), DB_MAC_SECRET_FILE)
  } catch (err) {
    // Sans le fichier, on retombe sur l'ancienne dérivation plutôt que de
    // priver la base de tout contrôle d'intégrité : un MAC faible vaut mieux
    // qu'aucun MAC, et la dégradation est journalisée.
    log('[db-mac] secret d’installation indisponible — dérivation dégradée :', err.message)
  }
  return crypto.pbkdf2Sync(`${hwid}:${installSecret}`, DB_MAC_SALT, 10_000, 32, 'sha256').toString('hex')
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

// ── Démarrage automatique au lancement de Windows ────────────────────────────
//
// L'application s'ouvre au démarrage de la session Windows via le mécanisme
// natif d'Electron (`app.setLoginItemSettings`), qui écrit l'entrée dans
// `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` — la ruche de
// l'UTILISATEUR. Aucun droit administrateur n'est demandé, et rien n'est
// installé en service.
//
// ── Pourquoi l'état n'est PAS gardé dans gf_settings.json ────────────────────
//
// Le registre est la seule source de vérité : un utilisateur peut retirer
// l'entrée lui-même (Gestionnaire des tâches → onglet Démarrage), ou le
// programme de désinstallation peut la supprimer. Un booléen recopié dans nos
// préférences afficherait alors un interrupteur « Activé » mensonger, et le
// garage croirait son logiciel lancé à chaque ouverture de session. On lit donc
// l'état RÉEL à chaque appel (`getLoginItemSettings`), et c'est lui qui pilote
// l'interrupteur.
//
// ── Windows uniquement ──────────────────────────────────────────────────────
//
// Sur macOS, `setLoginItemSettings` passe par les préférences système et son
// effet n'est pas immédiat ; le paquet ne cible que Windows. Ailleurs, on
// répond franchement `supported: false` plutôt que d'afficher un interrupteur
// inopérant.
function etatDemarrageAuto() {
  if (process.platform !== 'win32') {
    return { supported: false, enabled: false, raison: 'PLATEFORME' }
  }
  try {
    // `path` + `args` sont comparés par Electron : on fournit les mêmes valeurs
    // qu'à l'activation, sinon `enabled` retomberait à false sur une entrée que
    // nous venons nous-mêmes d'écrire (le cas d'une installation par utilisateur,
    // où l'exécutable est sous %LOCALAPPDATA%).
    const info = app.getLoginItemSettings({ path: process.execPath, args: demarrageArgs() })
    return {
      supported: true,
      enabled: !!info.openAtLogin,
      // Statut brut rendu tel quel ('enabled' | 'disabled' | 'not-registered'
      // selon Windows) : l'écran peut ainsi distinguer « jamais activé » de
      // « désactivé depuis le Gestionnaire des tâches », ce qu'un simple
      // booléen confondrait.
      statut: typeof info.status === 'string' ? info.status : undefined,
    }
  } catch (err) {
    log('[autostart] lecture impossible :', err.message)
    return { supported: true, enabled: false, erreur: err.message }
  }
}

/**
 * Arguments passés à l'exécutable au démarrage de session.
 *
 * `--autostart` permet à `main.js` de savoir qu'il est lancé par Windows et non
 * par l'utilisateur (fenêtre réduite dans la zone de notification au lieu de
 * s'ouvrir au premier plan) sans rien changer au reste du démarrage.
 */
function demarrageArgs() {
  return ['--autostart']
}

function definirDemarrageAuto(actif) {
  if (process.platform !== 'win32') {
    return { supported: false, enabled: false, raison: 'PLATEFORME' }
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: !!actif,
      openAsHidden: false,
      path: process.execPath,
      args: demarrageArgs(),
    })
    const etat = etatDemarrageAuto()
    // On annonce l'état RELU après écriture, jamais celui demandé : si Windows a
    // refusé l'opération (stratégie d'entreprise, registre verrouillé), l'écran
    // doit le montrer au lieu d'afficher un succès.
    if (etat.enabled !== !!actif) {
      return { ...etat, erreur: 'Windows n’a pas appliqué le réglage.' }
    }
    return etat
  } catch (err) {
    log('[autostart] écriture impossible :', err.message)
    return { supported: true, enabled: false, erreur: err.message }
  }
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
    const logsTail = lireQueueJournal(4000)
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
  // Consent may have been revoked AFTER a report was queued offline.
  if (!crashConsent()) return
  // `isPackaged` est indispensable : sans lui, une installation packagée — qui
  // n'embarque aucun .env — ne résolvait aucune base et sortait EN SILENCE
  // (GF31-AUD-043).
  const base = cp.resolveRemoteBase(process.env, { isPackaged: app.isPackaged })
  if (!base) {
    // Un canal muet ne doit plus l'être sans le dire.
    if (readCrashQueue().length > 0) log('[crash] aucune base distante résolue — envoi ignoré')
    return
  }
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
  const base = cp.resolveRemoteBase(process.env, { isPackaged: app.isPackaged })
  const lid  = activeLicense?.payload?.lid
  if (!base || !lid) {
    if (!base) log('[notifications] aucune base distante résolue — récupération ignorée')
    return
  }
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

/**
 * Ferme la session applicative (NextAuth) de l'utilisateur connecté.
 *
 * Appelée lors d'un CHANGEMENT DE LICENCE. Sans cela, la session ouverte sous
 * l'ancienne licence survivait à la bascule : après être passé sur une clé
 * MÉCANICIEN, l'instance continuait de servir des données de niveau
 * propriétaire — clients, devis, factures, utilisateurs, paramètres du garage,
 * export comptable FEC, et jusqu'à la SUPPRESSION d'un mécanicien (constaté :
 * HTTP 200 sur toutes ces routes). Le garde-fou prévu pour cela
 * (validateLicensedSession → LICENSE_WRONG_TYPE) ne s'exécute pas sur Electron,
 * où l'application des licences est désactivée par conception
 * (licenseEnforcementEnabled() renvoie false quand ELECTRON=1). Une fois la
 * session supprimée, ces mêmes routes répondent 401 — d'où ce nettoyage
 * explicite au moment précis où la frontière de privilège est franchie.
 */
async function clearAppSessionCookies() {
  const noms = [
    'next-auth.session-token',
    'next-auth.csrf-token',
    'next-auth.callback-url',
    '__Secure-next-auth.session-token',
    '__Host-next-auth.csrf-token',
  ]
  let supprimes = 0
  for (const name of noms) {
    try {
      await session.defaultSession.cookies.remove(APP_ORIGIN, name)
      supprimes++
    } catch (_) { /* cookie absent : rien à faire */ }
  }
  log('[session] session applicative fermée après changement de licence —', supprimes, 'cookie(s)')
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
    const buf = Buffer.alloc(15)
    const fd  = fs.openSync(dbPath, 'r')
    const taille = fs.fstatSync(fd).size
    if (taille < 512) {
      log('isDbValid: too small:', taille, 'bytes --', dbPath)
      fs.closeSync(fd)
      return false
    }
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
      // An installer/update must never reset an existing database, even if its
      // header is damaged. Preserve the exact file for recovery, fail closed.
      log('FATAL: existing database is unreadable; preserved without replacement')
      ecarterSplash()
      dialog.showErrorBox('GarageFlows — Base à récupérer',
        'La base existante est illisible. Elle a été conservée intacte ; aucune réinitialisation ne sera effectuée. Contactez le support pour récupérer votre sauvegarde.')
      app.exit(1)
      return false
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
      try {
        fs.copyFileSync(src, DB_PATH, fs.constants.COPYFILE_EXCL)
      } catch (_) {
        log('FATAL: first-run database could not be created exclusively; no existing data overwritten')
        ecarterSplash()
        dialog.showErrorBox('GarageFlows — Initialisation impossible', 'La base ne peut pas être créée sans risque. Aucune donnée existante n’a été écrasée. Vérifiez les permissions du dossier utilisateur.')
        app.exit(1)
        return false
      }
      log('Database initialised from template:', src)
    } else {
      log('FATAL: No database template found in resources — installation may be corrupted')
      ecarterSplash()
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
  return true

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
          res.on('end',  ()    => { try { resolve({ ...JSON.parse(data), httpStatus: res.statusCode }) } catch { resolve(null) } })
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
 * DERNIER refus explicite d'une autorité — `{ reason, authority }` ou null.
 * Ex. « Nombre maximal d'appareils atteint », « Cette clé n'est pas encore
 * attribuée à un mécanicien ». Conservé pour être présenté à l'utilisateur :
 * sans cela, le seul message actionnable restait enfermé dans le journal.
 *
 * Le repli LOCAL y est inclus, à la différence du contrôle de flux plus bas :
 * pour DÉCIDER, seule l'autorité distante fait foi ; pour DIRE ce qui se passe,
 * un refus local explicite reste la meilleure information disponible — le taire
 * laissait l'utilisateur devant une fenêtre muette.
 */
let lastActivationRefusal = null

/** Motif déjà JOURNALISÉ — évite de répéter la même ligne à chaque battement. */
let loggedActivationRefusal = null

/** Battements consécutifs où l'appareil n'a pas pu s'enregistrer. */
let deviceRetryStreak = 0

/** Refus explicites CONSÉCUTIFS — pilote l'espacement des tentatives. */
let activationRefusalStreak = 0

/** Horodatage du prochain enregistrement autorisé, ou null si aucun délai. */
let activationRetryAt = null

/** Au bout de N échecs d'affilée, on le signale UNE fois dans le journal. */
const DEVICE_RETRY_WARN_AT = 5

/**
 * Le backoff s'applique-t-il MAINTENANT à un enregistrement d'appareil ?
 *
 * `activateOnServer()` a QUATRE appelants. Le garde n'en couvrait qu'un — celui
 * de la branche `deviceRequired` — alors que le battement périodique en appelle
 * un autre AVANT lui : « pas encore de jeton d'appareil ? alors enregistre-toi ».
 * Or un refus ne délivre jamais de jeton : la condition restait vraie, et
 * l'application relançait une activation à CHAQUE battement malgré un délai
 * annoncé. Observé le 2026-08-09 à 00:40 sur le poste de l'opérateur — une
 * tentative 27 s après un « prochaine tentative dans 1 min ».
 */
function activationThrottled() {
  return !shouldAttemptActivation({
    refused:  !!lastActivationRefusal,
    retryAt:  activationRetryAt,
    now:      Date.now(),
  })
}

/**
 * Remet le backoff à neuf. À appeler quand l'utilisateur AGIT (saisie ou
 * changement de licence) : sa décision prime sur un délai calculé pour des
 * tentatives automatiques, et la situation qu'il vient de changer mérite un
 * essai immédiat.
 */
function resetActivationBackoff() {
  lastActivationRefusal   = null
  loggedActivationRefusal = null
  const fresh = cleared()
  activationRefusalStreak = fresh.refusalStreak
  activationRetryAt       = fresh.retryAt
}

/**
 * Enregistrement AUTOMATIQUE de l'appareil — le seul chemin que le battement
 * doit emprunter.
 *
 * Le garde vit ICI plutôt qu'à chaque appel : c'est précisément en le posant
 * appel par appel qu'on en a oublié un. Toute tentative non déclenchée par
 * l'utilisateur passe par cette fonction ; `activateOnServer()` ne reste appelé
 * directement que sur une action explicite (saisie ou changement de licence),
 * précédée d'un `resetActivationBackoff()`.
 *
 * @returns {Promise<?string>} l'autorité émettrice, ou null (échec OU différé).
 */
async function activateOnServerAuto() {
  if (activationThrottled()) return null

  // Motif AVANT la tentative — comparé par sa VALEUR, jamais par l'identité de
  // l'objet : `activateOnServer()` réaffecte `lastActivationRefusal` à un objet
  // NEUF à chaque refus, si bien qu'un `===` était toujours faux. Le streak
  // repartait donc de zéro à chaque fois et le délai restait figé à 1 min —
  // l'escalade 5 min / 15 min / 1 h n'était jamais atteinte (observé le
  // 2026-08-09 : trois refus d'affilée, trois fois « dans 1 min »).
  const motifAvant = lastActivationRefusal?.reason ?? null
  const authority = await activateOnServer()

  // Bilan de CETTE tentative — ici et nulle part ailleurs. Le tenir au point
  // d'appel laissait la tentative pré-battement hors comptabilité : elle
  // essuyait un refus sans repousser l'échéance, d'où deux tentatives par cycle.
  // Une autorité injoignable (aucune réponse, donc aucun refus) n'est PAS
  // espacée : il faut repartir dès le retour du réseau.
  if (lastActivationRefusal) {
    const memeMotif = lastActivationRefusal.reason === motifAvant
    const next = afterRefusal({
      refusalStreak: memeMotif ? activationRefusalStreak : 0,
      now: Date.now(),
    })
    activationRefusalStreak = next.refusalStreak
    activationRetryAt = next.retryAt
    log(`[license/activate] refus explicite — prochaine tentative dans ${humanDelay(next.delayMs)}`)
  } else {
    const fresh = cleared()
    activationRefusalStreak = fresh.refusalStreak
    activationRetryAt = fresh.retryAt
  }

  return authority
}

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

  const { response: res, decision } = await activateAtAuthority(httpPost, `${LICENSE_SERVER}/api/license/activate`, body)
  if (decision.kind === 'success') {
    activeDeviceToken = res.deviceToken
    saveLicense(activeLicense.token, activeLicense.payload, res.deviceToken)
    if (Array.isArray(res.modules)) currentModules = res.modules.slice().sort()
    lastActivationRefusal = null
    loggedActivationRefusal = null
    return 'remote'
  }
  // Panne/config et refus métier restent distincts jusque dans l'overlay.
  lastActivationRefusal = { reason: decision.reason, status: decision.status, authority: 'remote' }
  log('[license/activate] activation non effectuée —', decision.kind)
  return null
}

/**
 * Réplique la licence ACTIVE dans la base LOCALE du poste, sans lui donner la
 * moindre autorité.
 *
 * Pourquoi c'est nécessaire : activateOnServer() interroge l'autorité DISTANTE
 * en premier et RETOURNE dès qu'elle répond favorablement. La route locale
 * /api/license/activate — la SEULE à écrire une ligne LicenseKey dans le SQLite
 * du poste — n'est donc jamais appelée quand la machine est en ligne. La base
 * locale ignorait alors la licence garage active, et toute fonction qui la
 * cherche localement échouait : l'enregistrement d'une clé mécanicien répondait
 * « Licence garage parente introuvable pour ce garage », ce qui rendait l'onglet
 * « Accès mécaniciens » inutilisable dès que le poste avait du réseau. La voie
 * mécanicien faisait déjà cet enregistrement (establishMechanicSession) ; la
 * voie garage n'avait aucun équivalent — c'est cette asymétrie qui était le bug.
 *
 * Idempotent : le control plane distant reste l'autorité. Le résultat local
 * doit réussir avant ouverture d'une session ; le jeton distant est conservé. Si la ligne existe déjà, la route se contente d'actualiser lastSeenAt.
 */
async function recordLicenseInLocalDatabase() {
  if (!activeLicense?.token) return false
  const info = getSystemInfo()
  const res = await httpPost(`http://127.0.0.1:${PORT}/api/license/activate`, {
    license: activeLicense.token,
    hwid:    getHwid(),
    version: info.version,
    os:      info.os,
    arch:    info.arch,
  }).catch(() => null)
  const ok = !!(res && res.ok)
  log('[license] enregistrement dans la base locale —', ok ? 'OK' : 'échec')
  return ok
}

/**
 * Répercute la décision de l'autorité DISTANTE (revoked/suspended/active) dans
 * la base SQLite LOCALE, via la route interne protégée par X-Internal-Key.
 *
 * Sans ce miroir, la base locale ignorait les révocations : dès que le serveur
 * distant devenait injoignable, le contrôle local répondait « active » et le
 * repli levait le blocage (GF-FINAL-001). Best-effort : le miroir n'a AUCUNE
 * autorité propre — c'est une copie locale de la décision distante, pour que
 * le contrôle hors ligne soit d'accord avec l'autorité.
 */
async function mirrorLicenseStatusLocally(status) {
  const lid = activeLicense?.payload?.lid
  if (!lid) return false
  try {
    const body = JSON.stringify({ licenseId: lid, status })
    const { statusCode } = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: PORT, path: '/api/internal/license-status', method: 'POST' },
        res => { res.resume(); res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 })) }
      )
      req.on('error', reject)
      req.setHeader('Content-Type', 'application/json')
      req.setHeader('Content-Length', Buffer.byteLength(body))
      req.setHeader('x-internal-key', INTERNAL_EXPORT_KEY)
      req.write(body)
      req.end()
    })
    log('[license] miroir local du statut —', status, statusCode === 200 ? 'OK' : `HTTP ${statusCode}`)
    return statusCode === 200
  } catch (err) {
    log('[license] miroir local indisponible:', err.message)
    return false
  }
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
  // Qui a produit `result` : 'remote' (autorité) ou 'local' (repli). La
  // distinction est de SÉCURITÉ : seul un « active » DISTANT lève un blocage
  // (voir electron/heartbeat-policy.js — GF-FINAL-001).
  let resultAuthority = null

  // If we have no device token yet (fresh upgrade / offline activation), get one
  // before the heartbeat — the server rejects heartbeats without a device token.
  // Mais un refus explicite ne délivre AUCUN jeton : sans le garde de backoff,
  // cette ligne relançait une activation à chaque battement, indéfiniment.
  if (!activeDeviceToken) await activateOnServerAuto()

  // Télémétrie technique jointe au heartbeat (jamais de donnée métier).
  const info = getSystemInfo()
  // `platform` est ANNONCÉE : le serveur ne peut pas la deviner (le cloud sert
  // les deux surfaces depuis le même processus). Sans elle, tout client Electron
  // était classé « unknown » côté autorité et échappait à la politique de
  // version minimale — le mécanisme d'arrêt des versions obsolètes ne
  // s'appliquait donc à personne (GF31-AUD-053).
  const body = { licenseId, deviceToken: activeDeviceToken, platform: 'electron', version: info.version, os: info.os, arch: info.arch, hwid: getHwid() }

  // 1. Check remote license server — authoritative. URL officielle compilée :
  //    toujours interrogée (révocation/suspension), même sans .env.
  const remoteServer = LICENSE_SERVER
  if (remoteServer) {
    try {
      result = await httpPost(`${remoteServer.replace(/\/$/, '')}/api/license/check`, body)
      // Ne jamais journaliser la réponse complète (elle pourrait contenir un jeton) :
      // uniquement les champs de décision.
      if (result) {
        resultAuthority = 'remote'
        log('[license/check] remote result — allowed:', result.allowed,
            '| status:', result.status ?? '?', '| deviceRequired:', !!result.deviceRequired)
      }
    } catch (err) {
      log('[license/check] remote server unreachable (fail-open):', err.message)
    }
  }

  // 2. Fall back to local check
  if (!result) {
    try {
      result = await httpPost(`http://127.0.0.1:${PORT}/api/license/check`, body)
      if (result) {
        resultAuthority = 'local'
        log('[license/check] local result — allowed:', result.allowed,
            '| status:', result.status ?? '?', '| deviceRequired:', !!result.deviceRequired)
      }
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
    // Un refus EXPLICITE ne se dissipe pas tout seul : il attend un geste humain
    // (attribuer la clé, libérer un appareil…). Tant qu'il tient, on espace les
    // tentatives au lieu de rejouer le cycle à CHAQUE battement — ce que faisait
    // encore le code quand les DEUX autorités refusaient, cas non couvert par le
    // garde précédent (qui ne bornait que le repli derrière un refus distant).
    if (activationThrottled()) {
      // Overlay maintenu : le motif doit rester à l'écran pendant l'attente,
      // sinon l'utilisateur ne verrait plus ce qu'on attend de lui.
      if (lastActivationRefusal && mainWindow && !mainWindow.isDestroyed()) {
        const held = activationReport({
          status:        lastActivationRefusal.status,
          refusal:       lastActivationRefusal.reason,
          streak:        deviceRetryStreak,
          loggedRefusal: lastActivationRefusal.reason, // déjà journalisé : ne pas répéter
          warnAt:        DEVICE_RETRY_WARN_AT,
          authority:     lastActivationRefusal.authority,
        })
        if (held.overlay) mainWindow.webContents.send('license:revoked', held.overlay)
      }
      return
    }

    log('[license/check] device token required — re-activating this device')
    activeDeviceToken = null
    // Le bilan du refus (streak, échéance, journal) est tenu par
    // `activateOnServerAuto()` : un seul endroit, donc un seul comptage.
    const authority = await activateOnServerAuto()

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

    // Refus EXPLICITE de l'autorité (limite d'appareils, clé mécanicien pas
    // encore attribuée…) : seul un geste humain débloque la situation, et le
    // message n'existait que dans le journal. Ce qu'il faut dire — et à qui —
    // est décidé par un module testable ; voir electron/activation-report.js
    // pour les deux mensonges que cette séparation a supprimés.
    const report = activationReport({
      status:        lastActivationRefusal?.status,
      refusal:       lastActivationRefusal?.reason ?? null,
      streak:        deviceRetryStreak,
      loggedRefusal: loggedActivationRefusal,
      warnAt:        DEVICE_RETRY_WARN_AT,
      authority,
    })
    loggedActivationRefusal = report.loggedRefusal
    if (report.log) log(report.log)
    if (report.overlay && mainWindow && !mainWindow.isDestroyed()) {
      // Renvoyé à chaque battement tant que le refus tient : l'overlay
      // réapparaît ainsi après un rechargement accidentel de la page, comme
      // pour une licence bloquée.
      mainWindow.webContents.send('license:revoked', report.overlay)
    }
    return
  }

  // ── Décision de blocage/réactivation — module PUR (heartbeat-policy.js) ────
  // Invariant de sécurité (GF-FINAL-001) : un blocage n'est levé QUE par un
  // « active » explicite de l'autorité DISTANTE. Le repli local peut BLOQUER
  // (fail-secure), jamais réactiver — sinon couper le réseau vers l'autorité
  // suffisait à « réactiver » une licence révoquée au battement suivant.
  const decision = heartbeatDecision({ result, authority: resultAuthority, blocked: licenseBlocked })

  if (decision.action === 'block') {
    // ── Blocked: revoked / suspended / tampered ──────────────────────────────
    // Do NOT quit. Keep the app open and tell the renderer to show a persistent
    // blocking overlay, so the customer sees why access is blocked and can pick
    // up instantly (without losing unsaved work) the moment it is reactivated.
    if (!licenseBlocked) log('SECURITY: access blocked —', decision.status, '—', decision.reason)
    licenseBlocked   = true
    lastLicenseBlock = { status: decision.status, reason: decision.reason }
    // Persiste (signé) : le blocage survit au redémarrage, même hors ligne.
    persistLicenseBlock(decision.status, decision.reason)
    // Miroir en base locale : le contrôle local dira désormais la même chose
    // que l'autorité, même serveur distant injoignable. Uniquement pour une
    // décision DISTANTE de statut licence (jamais pour un refus d'appareil).
    if (resultAuthority === 'remote' && (decision.status === 'revoked' || decision.status === 'suspended')) {
      mirrorLicenseStatusLocally(decision.status).catch(() => {})
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Re-sent on every blocked check so the overlay reappears even after an
      // accidental page reload.
      mainWindow.webContents.send('license:revoked', { reason: decision.reason, status: decision.status })
    }
  } else if (decision.action === 'unblock') {
    // ── Réactivation confirmée par l'AUTORITÉ DISTANTE uniquement ────────────
    licenseBlocked   = false
    lastLicenseBlock = null
    clearPersistedLicenseBlock()
    // La réactivation est une décision admin distante : on la reflète aussi
    // dans la base locale (sinon le miroir 'revoked' y resterait à jamais).
    mirrorLicenseStatusLocally('active').catch(() => {})
    log('License reactivated — lid:', licenseId)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license:reactivated', { status: 'active' })
    }
  } else if (decision.action === 'hold') {
    // « active » venu du repli LOCAL pendant un blocage : on ne lève RIEN.
    log('[license/check] blocage MAINTENU — un « active » du repli local ne lève jamais un blocage (autorité distante requise)')
    if (lastLicenseBlock && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license:revoked', lastLicenseBlock)
    }
  }
  // decision.action === 'none' : statut 'unknown' (record pas encore enregistré /
  // DB fail-open) ou déjà actif → conserver l'état courant.

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

// ── Persistance de l'état de blocage licence (GF-FINAL-001) ───────────────────

function readPersistedLicenseBlock() {
  try {
    return verifyState(fs.readFileSync(LICENSE_BLOCK_FILE(), 'utf8'), installSecret, getHwid())
  } catch {
    return null
  }
}

function persistLicenseBlock(status, reason) {
  if (!installSecret) return
  try {
    // `lid` lie le blocage à LA licence bloquée : si l'utilisateur active une
    // autre clé (valide), le blocage persisté de l'ancienne ne la suit pas.
    const lid = activeLicense?.payload?.lid ?? null
    fs.writeFileSync(LICENSE_BLOCK_FILE(), signState({ status, reason, lid, ts: Date.now() }, installSecret, getHwid()), 'utf8')
  } catch (_) {}
}

function clearPersistedLicenseBlock() {
  try { fs.unlinkSync(LICENSE_BLOCK_FILE()) } catch (_) {}
}

// Politique d'ouverture au démarrage — module PUR (voir electron/startup-gate.js).
const { decisionDemarrage, decisionApresActivation, purgerBlocage } = require('./startup-gate')

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

  // Sans etat signe — installation NEUVE qui n'a jamais joint l'autorite —,
  // l'origine valait 0, soit 1970 : le logiciel se verrouillait trente secondes
  // apres le premier lancement d'un garage installant pendant une panne.
  // L'origine devient la creation du fichier de base : un repere qu'on ne remet
  // pas a zero sans perdre toutes ses donnees. Voir electron/grace-hors-ligne.js.
  let naissanceBase = null
  try {
    const st = fs.statSync(DB_PATH)
    naissanceBase = st.birthtimeMs || st.ctimeMs || null
  } catch (_) { /* base pas encore creee : tout premier demarrage */ }

  const verdict = evaluerGraceHorsLigne({
    enregistrement: rec,
    naissanceBase,
    maintenant: Date.now(),
    horlogeIncoherente: clockTampered,
    seuilAvertissementMs: GRACE_PERIOD_MS,
    seuilVerrouMs: LOCK_PERIOD_MS,
  })
  const offlineMs = verdict.offlineMs
  if (verdict.premierLancement) {
    log('[online-check] aucun etat de connexion : grace ancree sur la creation de la base')
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:online-status', { online: false, offlineMs })
  }

  // Verrouillage si : hors ligne trop longtemps OU horloge incohérente (recul
  // détecté / durée hors ligne négative) — impossible de gagner du temps en
  // reculant la date Windows.
  if (verdict.decision === 'verrou') {
    const why = verdict.motif === 'horloge'
      ? 'Incohérence de l\'horloge système détectée.'
      : 'Votre logiciel est hors ligne depuis plus de 72 heures.'
    log('[online-check] locking app —', verdict.motif === 'horloge' ? 'clock tamper' : 'offline > 72h')
    const { dialog: d } = require('electron')
    ecarterSplash()
    await d.showMessageBox(mainWindow ?? { webContents: null }, {
      type:    'error',
      title:   'GarageFlows — Connexion requise',
      message: 'GarageFlows nécessite une connexion internet.',
      detail:  `${why}\nVeuillez connecter ce PC à internet pour continuer à utiliser GarageFlows.`,
      buttons: ['Fermer'],
    }).catch(() => {})
    app.quit()
  } else if (verdict.decision === 'avertissement') {
    const remaining = Math.ceil((LOCK_PERIOD_MS - offlineMs) / (60 * 60 * 1_000))
    log(`[online-check] offline > 48h — warning (${remaining}h remaining)`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      ecarterSplash()
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

/**
 * Demande au SERVEUR un instantané cohérent (VACUUM INTO) vers `destination`.
 *
 * La sauvegarde ne peut pas être faite ici : ce processus n'a pas la connexion
 * SQLite. Un `fs.copyFileSync` depuis Electron pendant que le serveur écrit
 * produit une base DÉCHIRÉE — le mode de journalisation d'un poste est `delete`,
 * donc les pages modifiées vont dans le fichier principal pendant qu'un commit
 * est en cours. Le fichier obtenu a l'air d'une sauvegarde et ne se restaure pas.
 */
function backupViaServeur(destination) {
  const body = JSON.stringify({ destination })
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: '/api/internal/backup', method: 'POST' },
      res => {
        let acc = ''
        res.setEncoding('utf8')
        res.on('data', c => { acc += c })
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, raw: acc }))
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

/** Écrit une sauvegarde et dit la vérité si elle n'a PAS pu être écrite. */
async function ecrireSauvegarde(destination, etiquette) {
  try {
    const { statusCode, raw } = await backupViaServeur(destination)
    if (statusCode === 200) { log(`Backup ${etiquette}:`, destination); return true }
    // Aucun repli par copie d'octets : elle ressemblerait à une sauvegarde
    // valide sans en être une. Mieux vaut une sauvegarde manquante et signalée
    // qu'une sauvegarde présente et illisible le jour où on en a besoin.
    log(`Backup ${etiquette} ÉCHOUÉE (HTTP ${statusCode}):`, String(raw).slice(0, 200))
    return false
  } catch (err) {
    log(`Backup ${etiquette} ÉCHOUÉE (serveur injoignable):`, err.message)
    return false
  }
}

async function runBackup() {
  if (!fs.existsSync(DB_PATH)) return false
  let toutOk = true
  try {
    const d    = new Date()
    const yyyy = d.getFullYear()
    const mm   = String(d.getMonth() + 1).padStart(2, '0')
    const dd   = String(d.getDate()).padStart(2, '0')
    const HH   = String(d.getHours()).padStart(2, '0')

    // ── Hourly ──────────────────────────────────────────────────────────────
    fs.mkdirSync(BAK_HOURLY, { recursive: true })
    const hourlyFile = path.join(BAK_HOURLY, `garageflow_${yyyy}${mm}${dd}_${HH}.db`)
    if (await ecrireSauvegarde(hourlyFile, 'hourly')) pruneDir(BAK_HOURLY, 'garageflow_', 24)
    else toutOk = false

    // ── Daily (once per calendar day) ───────────────────────────────────────
    fs.mkdirSync(BAK_DAILY, { recursive: true })
    const dailyFile = path.join(BAK_DAILY, `garageflow_${yyyy}${mm}${dd}.db`)
    if (!fs.existsSync(dailyFile)) {
      if (await ecrireSauvegarde(dailyFile, 'daily')) pruneDir(BAK_DAILY, 'garageflow_', 7)
      else toutOk = false

      // ── Weekly (once per ISO week, triggered by first daily of the week) ──
      fs.mkdirSync(BAK_WEEKLY, { recursive: true })
      const [wyear, wnum] = isoWeek(d)
      const weeklyFile    = path.join(BAK_WEEKLY, `garageflow_${wyear}-W${String(wnum).padStart(2,'0')}.db`)
      if (!fs.existsSync(weeklyFile)) {
        if (await ecrireSauvegarde(weeklyFile, 'weekly')) pruneDir(BAK_WEEKLY, 'garageflow_', 4)
        else toutOk = false
      }
    }
    return toutOk
  } catch (err) { log('Backup error:', err.message); return false }
}

/** Dernier avertissement « sauvegardes en souffrance » (0 = jamais). */
let dernierAvertissementSauvegarde = 0

/**
 * Lit l'état RÉEL des sauvegardes horaires sur le disque.
 *
 * On ne tient pas un compteur d'échecs en mémoire : il repartirait à zéro à
 * chaque redémarrage, et un poste qu'on éteint tous les soirs n'atteindrait
 * jamais le seuil. Les fichiers déjà écrits sont la seule trace qui survit.
 */
function listerSauvegardesHoraires() {
  try {
    return fs.readdirSync(BAK_HOURLY)
      .filter(n => n.startsWith('garageflow_') && n.endsWith('.db'))
      .map(n => {
        try { return { nom: n, mtimeMs: fs.statSync(path.join(BAK_HOURLY, n)).mtimeMs } }
        catch (_) { return null }
      })
      .filter(Boolean)
  } catch (_) { return [] }
}

/**
 * Prévient quand plus AUCUNE sauvegarde ne réussit depuis assez longtemps.
 *
 * L'échec n'allait que dans `garageflow.log`. Un fichier que personne n'ouvre
 * n'avertit personne : le poste continuait à fonctionner, l'écran ne changeait
 * pas, et la dernière sauvegarde valide vieillissait en silence.
 */
async function signalerSauvegardesEnSouffrance() {
  let creationBase = null
  try { creationBase = fs.statSync(DB_PATH).birthtimeMs || null } catch (_) {}

  const verdict = evaluerSauvegardes({
    sauvegardes: listerSauvegardesHoraires(),
    maintenant: Date.now(),
    dernierAvertissement: dernierAvertissementSauvegarde,
    premierDemarrage: creationBase,
  })
  if (!verdict.alerter) return

  dernierAvertissementSauvegarde = Date.now()
  log(`[backup] AVERTISSEMENT — sauvegardes en souffrance (${verdict.motif}, âge ${verdict.ageMs})`)

  const quand = verdict.motif === 'aucune'
    ? 'Aucune sauvegarde n’a jamais pu être écrite sur ce poste.'
    : `La dernière sauvegarde réussie remonte à ${formulerAge(verdict.ageMs)}.`

  ecarterSplash()
  const r = await dialog.showMessageBox(mainWindow ?? { webContents: null }, {
    type: 'warning',
    title: 'GarageFlows — Sauvegarde impossible',
    message: 'GarageFlows n’arrive plus à sauvegarder vos données.',
    detail:
      quand + '\n\n'
      + 'Vos données actuelles sont intactes, mais elles ne sont plus protégées : '
      + 'en cas de panne du disque, il n’y aurait rien à restaurer.\n\n'
      + 'Causes fréquentes : disque plein, dossier verrouillé par un antivirus, '
      + 'ou disque externe débranché.\n\n'
      + 'Dossier des sauvegardes :\n' + BAK_DIR,
    buttons: ['Ouvrir le dossier', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).catch(() => null)

  if (r && r.response === 0) {
    try { fs.mkdirSync(BAK_DIR, { recursive: true }) } catch (_) {}
    try { shell.openPath(BAK_DIR) } catch (_) {}
  }
}

/** Sauvegarde périodique : elle s'exécute, et elle se PLAINT quand elle échoue. */
async function sauvegardePeriodique() {
  const ok = await runBackup()
  if (!ok) await signalerSauvegardesEnSouffrance()
  return ok
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

/**
 * Attend que NOTRE serveur reponde — pas n'importe lequel.
 *
 * La sonde interrogeait `/` et tenait pour « pret » tout serveur ecoutant sur
 * 127.0.0.1:4028. Si une autre application occupait deja ce port, la fenetre
 * chargeait SA page, et le garagiste voyait un ecran inexplicable. On interroge
 * donc `/api/health`, qui porte un marqueur d'identite : sans lui, on continue
 * d'attendre, puis on le DIT clairement.
 */
function waitForServer(timeoutMs = 30_000, signal) {
  return require('./server-ready').waitForHealth({ port: PORT, timeoutMs, expectedKey: INTERNAL_EXPORT_KEY, signal })
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
/**
 * Conseil adapté à la NATURE de la panne.
 *
 * La route de migration distingue déjà les échecs rattrapables (verrou
 * concurrent, interruption) de ceux qui ne le sont pas (intégrité de base
 * rompue, empreinte de migration incohérente). Ce champ était JETÉ par le
 * poste, qui conseillait « relancez » dans tous les cas — y compris là où
 * relancer échoue à l'identique, et fait perdre du temps avant le seul geste
 * utile : appeler le support et conserver la sauvegarde.
 */
function conseilMigration(recoverable) {
  if (recoverable === true) {
    return 'Relancez le logiciel ; si le problème persiste, contactez le support avec la référence ci-dessous.'
  }
  if (recoverable === false) {
    return 'Un simple redémarrage ne corrigera PAS ce problème : contactez le support avec la référence '
      + 'ci-dessous, et conservez la sauvegarde indiquée — c’est elle qui protège vos données.'
  }
  // La route n'a pas tranché : on ne prétend pas savoir, et on borne les essais.
  return 'Relancez le logiciel UNE fois ; si le même message revient, cessez de réessayer et contactez le '
    + 'support avec la référence ci-dessous.'
}

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
    req.on('error', err => {
      // Panne de transport vers notre propre serveur : relancer a de bonnes
      // chances de suffire.
      const e = new Error(`MIGRATION_HTTP_ERROR: ${err.message}`)
      e.recoverable = true
      reject(e)
    })
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
    // `recoverable` est calculé par la route (verrou concurrent, échec SQL
    // rattrapable…) puis était JETÉ ici — voir conseilMigration().
    const echec = new Error(`MIGRATION_FAILED:${code}${stage}${failed}`)
    echec.recoverable = result.recoverable === true ? true
      : result.recoverable === false ? false
      : null   // la route ne tranche pas : on ne prétendra pas savoir
    throw echec
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
      // Verdict RENDU (GF-024) : ce `return` muet laissait l'écran annoncer
      // « Export terminé — vérifiez votre bureau » alors qu'aucun fichier
      // n'avait été écrit, le dossier ayant été créé juste avant.
      return { ok: false, raison: `l'API d'export a répondu ${res.status}` }
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
    let fichiers = 0
    try { fichiers = fs.readdirSync(dir).length } catch { /* dossier illisible */ }
    return { ok: true, dir, fichiers }
  } catch (err) {
    log('Desktop export error:', err.message)
    return { ok: false, raison: err.message }
  }
}

/** Mémoire de la dernière exportation RÉUSSIE (horloge murale). */
const EXPORT_STATE_PATH = path.join(APP_DATA, 'export-quotidien.json')

/**
 * Repli en mémoire : si `%APPDATA%` n'est pas inscriptible (dossier verrouillé
 * par une stratégie d'entreprise, disque plein), le fichier ne se relit jamais
 * et l'export repartirait à chaque passage — toutes les cinq minutes. Cette
 * variable dégrade proprement le comportement à « une fois par exécution ».
 */
let dernierExportMemoire = null

function lireDernierExport() {
  let surDisque = null
  try {
    const v = JSON.parse(fs.readFileSync(EXPORT_STATE_PATH, 'utf8'))?.dernierExport
    if (Number.isFinite(v)) surDisque = v
  } catch (_) {
    // Illisible, absent, corrompu : on considère qu'aucun export n'a eu lieu.
    // Le défaut penche du côté de l'export en trop, jamais de l'export manqué.
  }
  if (surDisque === null) return dernierExportMemoire
  if (dernierExportMemoire === null) return surDisque
  return Math.max(surDisque, dernierExportMemoire)
}

function ecrireDernierExport(ts) {
  dernierExportMemoire = ts
  try {
    fs.mkdirSync(APP_DATA, { recursive: true })
    fs.writeFileSync(EXPORT_STATE_PATH, JSON.stringify({ dernierExport: ts }), 'utf8')
  } catch (e) { log('[export] mémoire non écrite:', e.message) }
}

/**
 * Vérifie l'échéance à intervalle court plutôt que de compter sur un long
 * minuteur.
 *
 * Un `setTimeout` de dix heures suppose que la machine reste éveillée et
 * allumée — deux suppositions fausses dans un garage. On regarde donc l'horloge
 * toutes les cinq minutes : c'est assez rare pour ne rien coûter, et assez
 * fréquent pour que l'export parte dans les minutes qui suivent 20 h, ou dans
 * les minutes qui suivent le rallumage quand 20 h est passé sans nous.
 */
const PAS_VERIFICATION_EXPORT_MS = 5 * 60 * 1_000

function scheduleDailyDesktopExport() {
  let enCours = false

  async function verifier() {
    if (enCours) return
    const verdict = evaluerEcheanceExport({
      maintenant: Date.now(),
      dernierExport: lireDernierExport(),
    })
    if (!verdict.doitExporter) return

    enCours = true
    try {
      log(`[export] déclenchement (${verdict.motif})`)
      const r = await runDesktopExport()
      // On ne mémorise QUE le succès : marquer un échec comme fait ferait sauter
      // la journée entière, alors que le prochain passage pourrait réussir.
      if (r && r.ok) ecrireDernierExport(Date.now())
      else log('[export] échec — nouvelle tentative au prochain passage:', r?.raison ?? 'motif inconnu')
    } catch (err) {
      log('Desktop export error:', err.message)
    } finally {
      enCours = false
    }
  }

  verifier().catch(() => {})
  desktopExportTimer = setInterval(() => { verifier().catch(() => {}) }, PAS_VERIFICATION_EXPORT_MS)
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
      reject(new Error(`Installation incomplète : serveur embarqué absent. Réinstallez GarageFlows.\n${serverJs}`))
      return
    }

    arretVoulu = false
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
      // Chiffrement AU REPOS des identifiants SMTP — sans quoi /api/email
      // refuse tout enregistrement de mot de passe (GF31-AUD-012).
      GF_SMTP_CIPHER_KEY:       smtpCipherKey,
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
    let serverReady = false
    const startupAbort = new AbortController()
    nextServer.on('exit', code => {
      log(`Next.js exited — code=${code}`)
      nextServer = null
      if (!serverReady) { startupAbort.abort(); return }

      // ── Mort du serveur : détectée, ANNONCÉE, et rattrapable ─────────────────
      // Elle n'était que journalisée. Sur un poste de comptoir allumé toute la
      // journée — épuisement mémoire du moteur Prisma au bout de quelques heures,
      // exception non rattrapée dans une route, arrêt par un antivirus — la
      // fenêtre restait ouverte sur une application qui ne répondait plus à
      // aucune requête. Aucun message, aucune relance : le garagiste voyait un
      // écran figé, et concluait « le logiciel a planté ».
      //
      // On ne relance PAS automatiquement en boucle : un serveur qui meurt d'une
      // base illisible remourrait aussitôt, et une boucle silencieuse masquerait
      // la panne au lieu de la traiter. On propose UNE relance, et on laisse
      // choisir.
      // On ne prévient pas l'écran par IPC : le préchargement n'expose aucun
      // canal pour cela, et l'écran est justement ce qui ne répond plus. La
      // boîte native est le seul chemin qui marche encore.
      if (arretVoulu) return
      ecarterSplash()
      dialog.showMessageBox(mainWindow ?? { webContents: null }, {
        type: 'error',
        title: 'GarageFlows — Le service interne s’est arrêté',
        message: 'GarageFlows ne peut plus enregistrer ni afficher vos données.',
        detail:
          'Le service interne du logiciel s’est arrêté de façon inattendue.\n\n'
          + 'Vos données ne sont pas perdues : elles restent sur ce poste.\n\n'
          + 'Relancez le service pour continuer à travailler. Si le problème revient, '
          + 'contactez le support en indiquant ce fichier :\n' + LOG_PATH,
        buttons: ['Relancer le service', 'Fermer GarageFlows'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }).then((r) => {
        if (r && r.response === 0) {
          log('[serveur] relance demandée par l’utilisateur')
          startNextServer().catch(e => log('[serveur] relance impossible:', e.message))
        } else {
          app.quit()
        }
      }).catch(() => {})
    })

    waitForServer(35_000, startupAbort.signal)
      .then(() => { serverReady = true; log('Next.js server ready'); resolve() })
      .catch(err => {
        log('Server unavailable:', err.message)
        arretVoulu = true
        try { nextServer?.kill() } catch (_) {}
        nextServer = null
        reject(err) // No migration or business window against an unavailable/foreign service.
      })
  })
}

// ── Windows ───────────────────────────────────────────────────────────────────

/**
 * Écarte le splash avant d'afficher un dialogue.
 *
 * Le splash est `alwaysOnTop` — c'est ce qui lui permet de rester visible
 * pendant un démarrage lent. Mais TOUS les dialogues d'échec du démarrage
 * s'affichaient DERRIÈRE lui : le garagiste ne voyait qu'un écran bloqué sur
 * « Presque prêt… », et tout le soin mis à écrire des messages français
 * actionnables était annulé au moment précis où ils comptent.
 *
 * On le retire du premier plan et on le masque : il n'a plus rien à dire dès
 * lors qu'un dialogue prend la parole.
 */
function ecarterSplash() {
  try { splashWindow?.setAlwaysOnTop(false) } catch (_) {}
  try { splashWindow?.hide() } catch (_) {}
}

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
  splashWindow.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } })
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

    ipcMain.on('license-submit', async (event, token) => {
      let payload
      try { payload = verifyEccToken(token) } catch {
        event.sender.send('license-error', 'Configuration de vérification indisponible. Contactez le support.')
        return
      }
      if (payload) {
        activeLicense = { token, payload }
        activeDeviceToken = null
        resetActivationBackoff()
        const authority = await activateOnServer()
        if (authority !== 'remote') {
          activeLicense = null
          activeDeviceToken = null
          event.sender.send('license-error', lastActivationRefusal?.reason || 'Service de vérification indisponible.')
          return
        }
        cleanup()
        // resolve(true) DOIT précéder win.destroy() : destroy() émet « closed »
        // de façon SYNCHRONE, et le gestionnaire de cette fenêtre appelle
        // resolve(false). La promesse se réglait donc sur false alors que la
        // licence venait d'être acceptée et enregistrée — l'appelant concluait
        // « Activation cancelled » et fermait l'application juste après que le
        // garage ait saisi une clé valide (il fallait relancer à la main).
        resolve(true)
        win.destroy()
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
    /**
     * Lancé par Windows au démarrage de session (`--autostart`, posé par le
     * réglage « Lancer GarageFlows au démarrage de Windows ») : la fenêtre
     * s'ouvre SANS voler le focus. L'utilisateur vient d'ouvrir sa session, son
     * premier clic ne doit pas atterrir dans un logiciel qu'il n'a pas demandé à
     * ce moment-là. L'application est bien visible et utilisable — elle n'est ni
     * masquée ni réduite, ce qui la rendrait introuvable sans icône de zone de
     * notification.
     */
    const lanceParWindows = process.argv.includes('--autostart')
    if (lanceParWindows) {
      try { mainWindow.blur() } catch (_) { /* le focus suit d'autres règles selon le gestionnaire de fenêtres */ }
    }
    log('Main window shown', lanceParWindows ? '(démarrage automatique)' : '')
  })

  // Fenêtres externes : n'ouvrir dans le navigateur QUE des URLs HTTPS vers des
  // domaines de confiance ; tout le reste est refusé (anti-phishing / protocoles
  // dangereux). Aucune nouvelle BrowserWindow n'est jamais créée par le renderer.
  const ALLOWED_EXTERNAL_HOSTS = new Set([
    'garageflows.fr', 'www.garageflows.fr', 'app.garageflows.fr', 'api.garageflows.fr',
  ])
  // `mailto:` et `sms:` sont les deux protocoles que le produit UTILISE
  // réellement : rappels client par courriel (repli sans SMTP configuré) et
  // rappels par SMS. Ils n'étaient pas dans la liste, donc refusés et seulement
  // journalisés : sous l'application packagée, les deux boutons ne faisaient
  // RIEN — et celui du courriel marquait tout de même le rappel « Envoyé » en
  // base (GF-FINAL-024). Ils sont remis à leur place ici, sans élargir la règle
  // aux protocoles arbitraires : tout le reste reste refusé par défaut.
  const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['mailto:', 'sms:'])
  // ── Le repli « téléchargement manuel » n'ouvrait rien (GF-024) ─────────────
  // Quand une mise à jour n'est pas signée, l'écran propose de la télécharger à
  // la main via `window.open(downloadUrl)`. Or les deux sources concernées sont
  // précisément celles qui ne portent pas de manifeste :
  //   · le repli GitHub  → https://github.com/…  (hôte hors liste) ;
  //   · la publication locale de la Zone Administrateur
  //     → http://127.0.0.1:<port>/api/admin/updates/file/… (protocole http).
  // Les deux étaient refusées et seulement journalisées : le bouton ne faisait
  // RIEN, sans le moindre message. On ouvre ces deux cas — et uniquement eux :
  // hôte exact pour GitHub, préfixe de chemin exact sur NOTRE propre serveur.
  const PREFIXE_INSTALLEUR_LOCAL = '/api/admin/updates/file/'
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      // Boucle locale : `APP_ORIGIN` dit « localhost » alors que l'URL de
      // l'installeur publié est construite sur « 127.0.0.1 » (main.js, repli
      // local-admin). Comparer les origines telles quelles échouerait donc
      // toujours — on accepte les deux écritures de la boucle, sur NOTRE port,
      // et sur ce seul préfixe de chemin.
      const estServeurEmbarque = u.protocol === 'http:'
        && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
        && u.port === String(PORT)
      if (u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
        shell.openExternal(url)
      } else if (ALLOWED_EXTERNAL_PROTOCOLS.has(u.protocol)) {
        // `mailto:` / `sms:` — rappels client. Sans cette branche, les deux
        // boutons de rappel ne font RIEN dans l'application packagée.
        shell.openExternal(url)
      } else if (u.protocol === 'https:' && u.hostname === 'github.com') {
        shell.openExternal(url)
      } else if (estServeurEmbarque && u.pathname.startsWith(PREFIXE_INSTALLEUR_LOCAL)) {
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

  // Démarrage automatique : LECTURE de l'état réel, puis écriture. Le renderer
  // ne peut rien d'autre que ces deux opérations — aucune clé de registre
  // arbitraire n'est exposée.
  ipcMain.handle('app:autostart-get', () => etatDemarrageAuto())
  ipcMain.handle('app:autostart-set', (_e, actif) => {
    log('[autostart] demande :', actif === true ? 'activer' : 'désactiver')
    return definirDemarrageAuto(actif === true)
  })
  ipcMain.handle('app:db-path',      () => DB_PATH)
  ipcMain.handle('app:open-backups', () => { fs.mkdirSync(BAK_HOURLY, { recursive: true }); shell.openPath(BAK_DIR) })
  ipcMain.handle('app:open-logs',    () => shell.openPath(LOG_PATH))

  ipcMain.handle('app:backup', async () => {
    // `runBackup()` est asynchrone depuis qu'il passe par le serveur : rendre
    // `success: true` sans l'attendre annonçait une sauvegarde qui n'avait pas
    // encore eu lieu — et qui pouvait échouer.
    const ok = await runBackup()
    return { success: ok, dir: BAK_DIR }
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
    // `{ ok: true }` était rendu INCONDITIONNELLEMENT, et `runDesktopExport`
    // avalait toutes ses erreurs : l'écran ne pouvait pas savoir qu'aucun
    // fichier n'avait été écrit (GF-024).
    const r = await runDesktopExport()
    return r ?? { ok: false, raison: 'export interrompu' }
  })

  /**
   * Ouverture d'un lien EXTERNE demandée explicitement par l'utilisateur.
   *
   * Le gestionnaire `setWindowOpenHandler` ne connaît que les domaines du
   * produit : tout `<a target="_blank">` vers un site tiers était refusé et
   * seulement journalisé. Les 135 liens « Site de la plateforme » du catalogue
   * de facturation électronique — publiés par impots.gouv.fr, donc par
   * construction hors de notre liste blanche — ne faisaient RIEN (GF-025).
   *
   * Ce point d'entrée est DÉLIBÉRÉMENT plus étroit qu'une liste blanche
   * d'hôtes : il n'ouvre que du HTTPS, refuse tout autre protocole (`file:`,
   * `javascript:`, `smb:`…) et rend un motif exploitable par l'écran. Le
   * renderer ne peut donc pas obtenir plus que « ouvrir une page web sûre ».
   */
  ipcMain.handle('app:open-external', async (_e, url) => {
    try {
      const u = new URL(String(url ?? ''))
      if (u.protocol !== 'https:') {
        log('[security] open-external refusé (protocole) :', u.protocol)
        return { ok: false, raison: 'non-https' }
      }
      await shell.openExternal(u.toString())
      return { ok: true }
    } catch {
      return { ok: false, raison: 'url-invalide' }
    }
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
    const base = cp.resolveRemoteBase(process.env, { isPackaged: app.isPackaged })
    const lid  = activeLicense?.payload?.lid
    if (!base || !lid || !notificationId) {
      if (!base) log('[notifications] aucune base distante résolue — accusé de réception ignoré')
      return { ok: false }
    }
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
    // Version RÉELLEMENT visée. Celle transmise par l'écran n'est qu'une
    // indication ; le manifeste signé, lorsqu'il y en a un, la remplace.
    let versionVisee = String(opts.version || '').trim() || null

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
      // Les valeurs SIGNÉES font autorité pour CE QUI est installé.
      expectedSha  = String(v.manifest.sha256 || '').trim().toLowerCase()
      expectedSize = v.manifest.size
      versionVisee = String(v.manifest.version || '').trim() || versionVisee

      // …mais pas nécessairement pour l'ENDROIT d'où viennent les octets.
      //
      // Remplacer inconditionnellement l'URL par celle du manifeste rendait la
      // publication par la Zone Administrateur inopérante de bout en bout :
      // `fetchLatestUpdate()` construit `http://127.0.0.1:<port><downloadPath>`
      // pour l'installeur téléversé par l'administrateur, et cette ligne
      // l'écrasait par l'URL publique du manifeste — laquelle DOIT viser un
      // domaine de la liste blanche, la boucle locale n'y figurant pas. Un
      // garage sans accès Internet téléversait donc un installeur qui n'était
      // jamais lu : le téléchargement partait vers api.garageflows.fr, échouait,
      // et l'utilisateur recevait « le téléchargement automatique a échoué ».
      // La contradiction était visible dans update-verify.js lui-même, où
      // `checkDownloadUrl` admet explicitement la boucle locale « parce que
      // c'est le serveur embarqué de l'application qui sert les publications de
      // la Zone Administrateur » — branche devenue inatteignable.
      //
      // Pourquoi conserver l'URL locale ne relâche RIEN : l'autorisation
      // d'exécuter tient à l'empreinte SHA-256 et à la taille SIGNÉES, vérifiées
      // ci-dessous avant tout lancement. Des octets servis en local qui ne
      // correspondent pas à ce que l'éditeur a signé sont refusés exactement
      // comme des octets servis à distance. La source ne décide que de l'endroit
      // d'où l'on tire un fichier dont le contenu est, lui, déjà déterminé.
      const urlLocale = (() => {
        try {
          const h = new URL(String(url || '')).hostname
          return h === '127.0.0.1' || h === '::1' || h === 'localhost'
        } catch { return false }
      })()
      if (!urlLocale) url = v.manifest.downloadUrl
      else log('[install-update] publication locale : octets servis par le serveur embarqué, empreinte signée conservée')

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

    // Sauvegarde de sécurité de la base AVANT toute installation.
    // `await` indispensable : sans lui, l'installation démarrait pendant que la
    // sauvegarde était encore en cours — une sauvegarde « de sécurité » qui
    // n'existe pas encore au moment où l'on en aurait besoin.
    try { await runBackup() } catch (e) { log('[install-update] pre-update backup failed:', e.message) }

    const emit = (pct) => { try { mainWindow?.webContents.send('app:update-progress', pct) } catch (_) {} }

    // ── Nom de fichier : assaini des DEUX côtés ────────────────────────────────
    // Seul `opts.fileName` l'était. Le repli — le dernier segment de l'URL —
    // passait par `decodeURIComponent` SANS filtre : un chemin se terminant par
    // « %2E%2E%5CGarageFlows.exe » redevenait « ..\GarageFlows.exe », et
    // `path.join(tmpDir, …)` écrivait alors HORS du dossier temporaire, à un
    // emplacement choisi par celui qui sert l'URL.
    const fileName = nomFichierSur(
      opts.fileName,
      nomFichierSur(
        decodeURIComponent((url.split('/').pop() || '').split('?')[0]),
        'GarageFlows-Setup.exe',
      ),
    )

    // ── Un dossier à nous, dans le dossier temporaire ──────────────────────────
    // Le fichier atterrissait directement dans `%TEMP%`, au milieu de tout le
    // reste : une collision de nom avec le résidu d'un autre programme, et le
    // `.part` repris n'était pas le nôtre. Un sous-dossier dédié isole le
    // téléchargement, et le garde STABLE d'un appel à l'autre — ce qui préserve
    // la reprise : un garagiste qui interrompt 200 Mo et reclique une heure plus
    // tard repart d'où il en était.
    //
    // Ce que cela ne prétend PAS faire : fermer la fenêtre entre la vérification
    // de l'empreinte et le lancement. Sous Windows, `%TEMP%` appartient déjà à
    // l'utilisateur courant ; un programme capable d'y échanger le fichier
    // tourne avec ses droits et pourrait tout aussi bien modifier l'application
    // elle-même. Un dossier tiré au sort donnerait l'illusion d'une barrière
    // sans en être une, et coûterait la reprise.
    const tmpDirGf = path.join(tmpDir, 'gf-update')
    try { fs.mkdirSync(tmpDirGf, { recursive: true }) } catch (_) {}
    const destPath = path.join(tmpDirGf, fileName)
    const partPath = destPath + '.part'

    // Téléchargement REPRENABLE : requête Range, reprise du .part sur coupure,
    // avec ré-essais (backoff). Le serveur/CDN gère nativement le Range.
    function downloadOnce(startUrl) {
      return new Promise((resolve, reject) => {
        let settled = false
        /**
         * Un `.part` résiduel a-t-il déjà été purgé pour cette tentative ?
         *
         * La reprise envoie `Range: bytes=<taille du .part>-`. Si ce reliquat est
         * PLUS GROS que le fichier visé — une release précédente plus lourde, un
         * fichier corrompu — le serveur répond 416 et la tentative échoue. Rien
         * ne nettoyait ce fichier : toutes les tentatives suivantes échouaient à
         * l'identique, et le poste perdait la mise à jour automatique
         * DURABLEMENT, le seul remède étant un vidage manuel de %TEMP%.
         */
        let reliquatPurge = false

        const doReq = (u, redirects) => {
          if (redirects > 5) { settled = true; return reject(new Error('Trop de redirections')) }
          // Chaque saut est revalidé : sans cela, un en-tête `Location` suffisait
          // à quitter la liste blanche et à retomber en HTTP clair, annulant les
          // deux garanties que l'URL initiale avait pourtant subies
          // (GF31-AUD-057).
          const autorisee = updateVerify.checkDownloadUrl(u)
          if (!autorisee.ok) {
            settled = true
            log('[install-update] SECURITY: redirection refusée —', autorisee.reason)
            return reject(new Error(autorisee.reason))
          }
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
              // Résolution RELATIVE à l'URL courante : un `Location` relatif est
              // licite, et le résoudre nous-mêmes évite de laisser la
              // bibliothèque HTTP décider à notre place.
              let suivante
              try { suivante = new URL(res.headers.location, u).toString() } catch { suivante = '' }
              res.resume()
              if (!suivante) { fail(new Error('Redirection illisible')); return }
              doReq(suivante, redirects + 1); return
            }
            let append, total
            if (res.statusCode === 206) {
              append = true
              const cr = res.headers['content-range'] // bytes start-end/total
              total = cr ? parseInt(cr.split('/')[1], 10) : existing + parseInt(res.headers['content-length'] || '0', 10)
            } else if (res.statusCode === 200) {
              append = false // le serveur ignore Range → on repart de zéro
              total = parseInt(res.headers['content-length'] || '0', 10)
            } else if (res.statusCode === 416 && !reliquatPurge) {
              // « Range Not Satisfiable » : le reliquat ne correspond plus à ce
              // fichier. On le jette et on repart de zéro — une seule fois, pour
              // qu'une réponse 416 obstinée ne fasse pas boucler.
              res.resume()
              reliquatPurge = true
              log('[install-update] reliquat incohérent — reprise depuis le début')
              try { fs.rmSync(partPath, { force: true }) } catch (_) {}
              doReq(u, redirects)
              return
            } else {
              res.resume()
              // Un échec laisse un reliquat qui ferait échouer la tentative
              // suivante de la même façon : on ne le conserve que s'il a une
              // chance de servir (reprise partielle valide).
              if (res.statusCode >= 400) { try { fs.rmSync(partPath, { force: true }) } catch (_) {} }
              return fail(new Error('HTTP ' + res.statusCode))
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

      /**
       * Lance l'installateur et RÉPOND s'il a réellement démarré.
       *
       * L'échec était avalé deux fois : `spawn` en `catch`, puis `openPath` dans
       * un `catch` vide — et l'application quittait de toute façon. Un antivirus
       * qui bloque l'exécutable, un fichier verrouillé, un disque plein : l'écran
       * affichait « fermeture… », l'application disparaissait, et rien ne
       * s'installait. Aucun message, aucune trace pour le garagiste, qui
       * relançait un logiciel identique en se demandant ce qu'il avait raté.
       *
       * `spawn` ne lève pas toujours en synchrone sous Windows : l'échec arrive
       * par l'événement `error`. On attend donc brièvement de voir.
       */
      const launchInstaller = () => new Promise((resolve) => {
        let regle = false
        const finir = (ok) => { if (!regle) { regle = true; resolve(ok) } }
        try {
          const child = spawn(destPath, [], { detached: true, stdio: 'ignore' })
          child.on('error', (e) => {
            log('[install-update] spawn error:', e.message)
            finir(false)
          })
          // Un pid attribué et aucune erreur : Windows a créé le processus.
          setTimeout(() => finir(Boolean(child.pid)), 500)
          child.unref()
        } catch (e) {
          log('[install-update] spawn failed:', e.message)
          finir(false)
        }
      })

      // Laisse ~1,2 s à l'UI pour afficher « fermeture… », lance l'installeur,
      // puis ferme proprement (le serveur Next est arrêté dans window-all-closed).
      setTimeout(async () => {
        let lance = await launchInstaller()

        if (!lance) {
          // Repli : demander au shell d'ouvrir le fichier. `openPath` rend une
          // chaîne VIDE en cas de succès, le motif sinon — on la lit, au lieu de
          // l'ignorer comme avant.
          try {
            const motif = await shell.openPath(destPath)
            lance = motif === ''
            if (!lance) log('[install-update] openPath refusé:', motif)
          } catch (e) {
            log('[install-update] openPath a levé:', e.message)
          }
        }

        if (!lance) {
          // On NE QUITTE PAS : fermer maintenant laisserait le garagiste sans
          // logiciel ET sans mise à jour. Mieux vaut rester en l'état et le dire.
          log('[install-update] installateur non démarré — l’application reste ouverte')
          // `app:update-error` — le SEUL canal de mise à jour que le préchargement
          // expose (`onUpdateError`) et que `UpdateModal` écoute réellement. Un
          // canal inventé serait du code mort qui laisserait croire que l'écran
          // est prévenu.
          try {
            mainWindow?.webContents.send(
              'app:update-error',
              'La mise à jour n’a pas pu démarrer. GarageFlows reste utilisable.',
            )
          } catch (_) {}
          try {
            ecarterSplash()
            await dialog.showMessageBox(mainWindow ?? { webContents: null }, {
              type: 'warning',
              title: 'GarageFlows — Mise à jour non lancée',
              message: 'La mise à jour n’a pas pu démarrer.',
              detail:
                'GarageFlows reste utilisable : rien n’a été modifié.\n\n'
                + 'Le fichier téléchargé se trouve ici :\n' + destPath + '\n\n'
                + 'Un antivirus peut avoir bloqué son exécution. Vous pouvez le lancer '
                + 'vous-même, ou réessayer plus tard.',
              buttons: ['Fermer'],
              noLink: true,
            })
          } catch (_) {}
          return
        }

        // L'installateur est parti : on le NOTE avant de fermer. Si la version
        // installée n'a pas changé au prochain démarrage, on saura que cette
        // tentative-là n'a rien donné, et on ne la reproposera pas en boucle.
        if (versionVisee) ecrireTentativeMaj(versionVisee)

        // Petit délai pour que le process détaché démarre avant le quit.
        setTimeout(() => {
          arretVoulu = true
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
      // Changement RÉEL de licence (identité ou type) : la session ouverte sous
      // l'ancienne licence ne doit pas survivre à la bascule. Voir
      // clearAppSessionCookies() pour ce qui restait accessible sans ce nettoyage.
      const ancienne = activeLicense?.payload ?? null
      const licenceDifferente = !ancienne || ancienne.lid !== payload.lid || ancienne.typ !== payload.typ
      // État complet d'AVANT la bascule — nécessaire pour revenir en arrière si
      // l'autorité refuse la nouvelle clé (voir plus bas).
      const licencePrecedente = activeLicense
      const jetonAppareilPrecedent = activeDeviceToken
      // A new license key = a new device binding: drop the old device token.
      activeLicense = { token: token.trim(), payload }
      activeDeviceToken = null
      // Save new license to disk (encrypted with HWID)
      saveLicense(token.trim(), payload)
      // Register this device against the new license to obtain a fresh token.
      // Changement de licence à l'initiative de l'utilisateur : le délai calculé
      // pour l'ANCIENNE clé ne doit pas retarder celle qu'il vient de saisir.
      // (`resetActivationBackoff` remet aussi `lastActivationRefusal` à null :
      // le motif lu juste après provient donc bien de CETTE tentative.)
      resetActivationBackoff()
      const autorite = await activateOnServer()

      // ── Le verdict de l'autorité était jeté (GF-009) ───────────────────────
      // `activateOnServer()` était appelée sans lire sa valeur, puis le handler
      // renvoyait inconditionnellement `{ ok: true }`. Une clé explicitement
      // REFUSÉE — siège déjà consommé, licence révoquée, empreinte matérielle
      // d'une autre machine — s'affichait donc « Licence activée (premium) » et
      // l'application se rechargeait, alors que la clé avait déjà été écrite sur
      // le disque et ses cookies posés.
      //
      // On distingue les deux causes possibles d'un `null` :
      //   · autorité INJOIGNABLE / erreur technique → activation non effectuée ;
      //   · REFUS EXPLICITE de l'autorité distante → réponse définitive. On
      //     restaure l'état précédent et on renvoie le motif.
      if (autorite !== 'remote') {
        const motif = lastActivationRefusal?.reason || 'Service de vérification indisponible.'
        activeLicense = licencePrecedente
        activeDeviceToken = jetonAppareilPrecedent
        try {
          if (licencePrecedente?.token) {
            saveLicense(licencePrecedente.token, licencePrecedente.payload, jetonAppareilPrecedent ?? null)
          } else if (fs.existsSync(LIC_PATH)) {
            // Aucune licence avant la tentative : ne pas laisser sur le disque
            // une clé que l'autorité vient de refuser.
            fs.unlinkSync(LIC_PATH)
          }
        } catch (e) {
          log('[update-license] restauration de la licence précédente impossible:', e.message)
        }
        log('[update-license] REFUSÉ par l’autorité —', motif)
        return { ok: false, reason: motif }
      }
      // La DB locale doit aussi confirmer l'activation avant toute nouvelle session.
      const localReady = payload.typ === 'mechanic'
        ? await establishMechanicSession()
        : await recordLicenseInLocalDatabase()
      if (!localReady) {
        activeLicense = licencePrecedente
        activeDeviceToken = jetonAppareilPrecedent
        if (licencePrecedente?.token) saveLicense(licencePrecedente.token, licencePrecedente.payload, jetonAppareilPrecedent ?? null)
        else if (fs.existsSync(LIC_PATH)) fs.unlinkSync(LIC_PATH)
        return { ok: false, reason: 'Vérification locale indisponible. Activation non effectuée.' }
      }
      await injectLicenseCookies(payload.typ, payload.lid ?? 'runtime')
      if (licenceDifferente) await clearAppSessionCookies()

      log('[update-license] upgraded to type:', payload.typ, '| lid:', payload.lid)
      return {
        ok:          true,
        licenseType: payload.typ,
        expiryAt:    new Date(payload.exp * 1000).toISOString(),
        isAdmin:     payload.typ === 'admin',
      }
    } catch (err) {
      log('[update-license] error:', err.message)
      return { ok: false, code: err.code === 'SERVER_MISCONFIGURED' ? err.code : 'INTERNAL_ERROR',
        reason: 'Vérification indisponible. Activation non effectuée ; contactez le support.' }
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
    ecarterSplash()
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
    ecarterSplash()
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
        ecarterSplash()
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
          // buildId identifie le PAQUET, pas la version : deux paquets 1.1.0
          // peuvent différer, et une installation qui n'a rien écrit ne se voit
          // autrement nulle part. Voir electron/integrity.js.
          log('[integrity] OK —', result.checked, 'fichiers critiques vérifiés',
              '| paquet:', result.buildId ?? 'inconnu')
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
            ecarterSplash()
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
  if (!setupDatabase()) return

  // ── SAUVEGARDE PRÉ-MIGRATION (AVANT le serveur, AVANT toute migration) ─────
  // La base n'est ouverte par aucun processus ici → copie (db + -wal + -shm)
  // COHÉRENTE, puis VÉRIFIÉE (en-tête SQLite, taille). Une sauvegarde invalide
  // BLOQUE le démarrage : aucune migration ne s'exécutera sans copie sûre.
  const { createPreMigrationBackup } = require('./pre-migration-backup')
  const PRE_MIGRATION_DIR = path.join(BAK_DIR, 'pre-migration')
  const preBackup = createPreMigrationBackup(DB_PATH, PRE_MIGRATION_DIR)
  if (!preBackup.ok) {
    log('[FATAL] sauvegarde pré-migration invalide:', preBackup.error)
    ecarterSplash()
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
    try { assertLicenseTrust(PUBLIC_KEY_PEM) } catch {
      ecarterSplash()
      dialog.showErrorBox('GarageFlows — Configuration indisponible', 'SERVER_MISCONFIGURED : la clé publique de vérification est inutilisable. Contactez le support.')
      app.quit()
      return
    }
    let payload = checkStoredLicense()

    // ── Blocage PERSISTÉ — évalué ICI, avant toute ouverture (GF-DUR-019) ────
    //
    // Le blocage était bien persisté et signé, mais il n'était relu qu'APRÈS
    // `createMainWindow()` : le serveur Next démarrait, le tableau de bord se
    // chargeait, s'affichait — planning, clients, factures — et n'était RECOUVERT
    // d'un calque qu'au `did-finish-load`. Une licence révoquée ou suspendue
    // ouvrait donc réellement l'application, données comprises, le temps d'un
    // chargement de page. Le jeton ECDSA, lui, reste cryptographiquement valide :
    // ce n'est pas lui qui porte la révocation.
    //
    // La décision est donc prise avant le serveur et avant la fenêtre : une
    // licence bloquée est traitée exactement comme une licence absente.
    const auDemarrage = decisionDemarrage({ licence: payload, blocage: readPersistedLicenseBlock() })
    if (payload && auDemarrage.action === 'activation') {
      log('SECURITY: licence bloquée (état persisté) —', auDemarrage.statut, '— activation requise')
      payload = null
      activeLicense = null
    }

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

    // MÊME contrôle après activation : recoller la clé bloquée ne doit pas
    // ouvrir l'application — y compris hors ligne, où l'activation ne peut pas
    // interroger l'autorité de licence.
    const blocageCourant = readPersistedLicenseBlock()
    const apres = decisionApresActivation({ licence: payload, blocage: blocageCourant })
    if (apres.action === 'refus') {
      log('SECURITY: clé bloquée présentée à l’activation —', apres.statut)
      ecarterSplash()
      dialog.showErrorBox(
        'GarageFlows — Licence bloquée',
        apres.motif +
          '\n\nElle ne peut pas être réactivée depuis ce poste. Contactez votre revendeur ' +
          'ou saisissez une autre clé au prochain démarrage.',
      )
      app.quit()
      return
    }

    // Une clé DIFFÉRENTE et valide purge le blocage de l'ancienne : sans cela,
    // le fichier resterait à traîner et bloquerait une licence sans rapport le
    // jour où son `lid` viendrait à manquer.
    if (purgerBlocage(blocageCourant, payload.lid ?? null)) clearPersistedLicenseBlock()

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
    ecarterSplash()
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
    ecarterSplash()
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'GarageFlows — Migration de la base interrompue',
      message: 'La mise à jour de la base de données a échoué. Vos données n\'ont pas été perdues.',
      detail:
        `${backupInfo}\n\n` +
        'GarageFlows va se fermer par sécurité (aucune donnée ne sera modifiée en l\'état).\n' +
        conseilMigration(err.recoverable) + '\n\n' +
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

  // Aucune fenêtre métier si la validation locale DB/appareil échoue.
  if (!IS_DEV && activeLicense?.token) {
    const localReady = await (activeLicense.payload?.typ === 'mechanic'
      ? establishMechanicSession()
      : recordLicenseInLocalDatabase()).catch(() => false)
    if (!localReady) {
      ecarterSplash()
      dialog.showErrorBox('GarageFlows — Vérification indisponible',
        'La vérification locale n’a pas abouti. Aucune session métier ne sera ouverte. Réessayez plus tard.')
      app.quit()
      return
    }
  }

  // ── Open main window ──────────────────────────────────────────────────────
  createMainWindow()

  // ── Blocage licence persisté : décidé PLUS HAUT, pas ici (GF-DUR-019) ──────
  //
  // Ce bloc restaurait `licenseBlocked` APRÈS l'ouverture de la fenêtre, et
  // comptait sur un calque envoyé au `did-finish-load` pour masquer une
  // application déjà chargée. Le tableau de bord d'une licence révoquée
  // s'affichait donc réellement — brièvement, mais réellement, données
  // comprises.
  //
  // Un calque n'est pas un contrôle d'accès. La décision est prise avant le
  // démarrage du serveur Next et avant toute fenêtre : une licence bloquée ne
  // parvient jamais jusqu'ici. Le blocage EN COURS D'EXÉCUTION reste géré par
  // le battement de cœur (`startPeriodicLicenseCheck`), qui pose l'overlay sur
  // une application déjà ouverte — c'est son rôle, et c'est un cas différent.

  // Diffuse les modules connus + récupère les notifications dès l'ouverture.
  broadcastEntitlements()
  if (!IS_DEV) {
    setTimeout(() => { fetchNotifications().catch(() => {}); flushCrashQueue().catch(() => {}) }, 5_000)
  }

  // ── Auto-backup ────────────────────────────────────────────────────────────
  // `sauvegardePeriodique` et non `runBackup` : c'est elle qui avertit quand la
  // sauvegarde ne passe plus. `runBackup` reste le geste nu, utilisé là où
  // l'appelant traite déjà l'échec (bouton manuel, pré-mise à jour).
  sauvegardePeriodique().catch(e => log('[backup] boucle:', e.message))
  backupTimer = setInterval(
    () => { sauvegardePeriodique().catch(e => log('[backup] boucle:', e.message)) },
    60 * 60 * 1_000,
  )

  // ── Daily desktop export at 20:00 ─────────────────────────────────────────
  scheduleDailyDesktopExport()

  // ── Periodic license revocation check (production only) ───────────────────
  if (!IS_DEV) {
    startPeriodicLicenseCheck()
    startOnlineGraceCheck()
  }

  // ── Vérification des mises à jour : au démarrage puis toutes les heures ────
  // La purge passe d'abord : un disque encombré par d'anciens installateurs est
  // ce qui fera échouer la prochaine mise à jour.
  purgerTelechargementsMaj()
  startPeriodicUpdateCheck()
})

app.on('before-quit', () => {
  arretVoulu = true
  try { nextServer?.kill() } catch (_) {}
  nextServer = null
})

app.on('window-all-closed', () => {
  if (backupTimer)       { clearInterval(backupTimer);         backupTimer       = null }
  if (licenseTimer)      { clearTimeout(licenseTimer);         licenseTimer      = null }
  if (onlineCheckTimer)  { clearInterval(onlineCheckTimer);    onlineCheckTimer  = null }
  if (updateTimer)       { clearInterval(updateTimer);         updateTimer       = null }
  // `clearInterval` — l'échéance d'export est un intervalle depuis qu'elle ne
  // dépend plus d'un compte à rebours de dix heures.
  if (desktopExportTimer){ clearInterval(desktopExportTimer);  desktopExportTimer = null }
  if (nextServer) {
    const pid = nextServer.pid
    log('Stopping Next.js server (pid ' + pid + ')…')
    arretVoulu = true
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
    // ── Pendant le démarrage, la fenêtre principale n'existe PAS encore ────────
    // Le poste attend le serveur Next : jusqu'à 35 secondes sur une machine
    // lente, davantage au premier lancement après une mise à jour. Un garagiste
    // qui double-clique pendant ce temps ne voyait STRICTEMENT rien — la
    // deuxième instance rendait la main en silence. Il recliquait, deux fois,
    // cinq fois, convaincu que le logiciel ne se lançait pas.
    //
    // À défaut de fenêtre principale, on ramène le splash au premier plan :
    // c'est lui qui dit « GarageFlows démarre », et c'est exactement la réponse
    // attendue.
    // Un splash MASQUÉ l'a été volontairement, pour laisser la place à une boîte
    // de dialogue (`ecarterSplash`). Le remettre devant volerait le focus au
    // message qu'on veut justement faire lire.
    const splashUtilisable =
      splashWindow && !splashWindow.isDestroyed() && splashWindow.isVisible()
    const fenetre = (mainWindow && !mainWindow.isDestroyed())
      ? mainWindow
      : (splashUtilisable ? splashWindow : null)
    if (!fenetre) return
    try {
      if (fenetre.isMinimized()) fenetre.restore()
      fenetre.show()
      fenetre.focus()
    } catch (_) { /* fenêtre détruite entre-temps */ }
  })
}

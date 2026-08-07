'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Vérification d'intégrité (anti-altération)
//
//  Au démarrage, GarageFlow.exe vérifie l'empreinte SHA-256 de ses fichiers
//  critiques contre un MANIFESTE signé (HMAC-SHA256, clé dérivée du secret
//  fragmenté). Si un fichier est modifié, supprimé ou remplacé → arrêt.
//
//  Fichiers couverts (rapides à hacher — pas le serveur Next entier) :
//    • app.asar                → tout le code applicatif Electron + package.json
//    • app.asar.unpacked/**    → modules natifs déballés (moteur Prisma, DLL)
//    • keys/public.pem         → clé publique de licence (sécurité)
//    • prisma/schema.prisma    → schéma de base
//
//  ⚠️ Le GÉNÉRATEUR (build) et le VÉRIFICATEUR (runtime) partagent la MÊME
//  fonction de sélection (`criticalFiles`) : ils ne peuvent donc jamais diverger
//  sur l'ensemble des fichiers ni la résolution des chemins — pas de faux
//  positif dû à un décalage de chemins.
//
//  ⚠️ Limite honnête : une vérification faite EN JS peut, en théorie, être
//  neutralisée par un attaquant qui patche le vérificateur lui-même. Cette
//  couche stoppe les altérations « ordinaires » (remplacer une DLL, éditer une
//  ressource, supprimer un fichier). Pour une résistance forte, la combiner avec
//  la SIGNATURE NUMÉRIQUE du binaire (voir docs/SECURITY-HARDENING.md).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MANIFEST_NAME = 'integrity.manifest.json'

// ── Robustesse aux verrous de fichiers TRANSITOIRES (anti faux-positif) ───────
//  Au démarrage sous Windows, app.asar (et les modules déballés) peuvent être
//  momentanément VERROUILLÉS par un tiers légitime : analyse temps réel de
//  l'antivirus/Defender, indexeur de recherche, logiciel de sauvegarde. La
//  lecture échoue alors avec EBUSY/EACCES/… — une condition RÉCUPÉRABLE qui n'a
//  RIEN à voir avec une altération. Sans réessai, cet échec transitoire était
//  compté comme « fichier illisible » → « installation corrompue » (faux positif
//  intermittent, fichier pourtant intact).
//
//  On réessaie donc les erreurs d'E/S transitoires avec un court backoff. Ce qui
//  n'est JAMAIS masqué : une vraie altération (le contenu diffère → empreinte
//  différente → « modified ») et une vraie suppression (ENOENT persistant →
//  « missing »). L'anti-tamper reste donc pleinement actif.
const TRANSIENT_IO_CODES = new Set([
  'EBUSY', 'EACCES', 'EPERM', 'EMFILE', 'ENFILE', 'EAGAIN', 'EWOULDBLOCK', 'ETXTBSY',
])

function isTransientIoError(err) {
  return !!err && TRANSIENT_IO_CODES.has(err.code)
}

// Sommeil SYNCHRONE borné (l'intégrité est vérifiée en synchrone au démarrage).
function sleepSync(ms) {
  const d = Math.max(0, ms | 0)
  if (!d) return
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, d) }
  catch { /* SharedArrayBuffer indisponible → pas de sommeil (réessai immédiat) */ }
}

// Lecture d'un fichier avec réessai sur erreur d'E/S TRANSITOIRE uniquement.
// Une erreur non transitoire (ENOENT, EISDIR, …) ou l'épuisement des réessais
// est propagée telle quelle. Délais par défaut : 60,120,180,240 ms (~600 ms max).
function readFileWithRetry(abs, { readFile = fs.readFileSync, sleep = sleepSync, retries = 4, baseDelayMs = 60 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return readFile(abs) }
    catch (err) {
      lastErr = err
      if (!isTransientIoError(err) || attempt === retries) throw err
      sleep(baseDelayMs * (attempt + 1))
    }
  }
  throw lastErr
}

// ── Sélection des fichiers critiques (PARTAGÉE build ↔ runtime) ───────────────
function walk(dir, base, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, base, out)
    else if (e.isFile()) out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), abs })
  }
}

// Renvoie la liste { rel, abs } des fichiers critiques présents sous resourcesPath.
function criticalFiles(resourcesPath) {
  const out = []
  const push = (rel) => {
    const abs = path.join(resourcesPath, rel)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      out.push({ rel: rel.split(path.sep).join('/'), abs })
    }
  }
  push('app.asar')
  push('keys/public.pem')
  push('prisma/schema.prisma')

  const unpacked = path.join(resourcesPath, 'app.asar.unpacked')
  if (fs.existsSync(unpacked)) walk(unpacked, resourcesPath, out)

  // Dédoublonne + tri déterministe par chemin relatif.
  const seen = new Set()
  return out
    .filter((f) => (seen.has(f.rel) ? false : (seen.add(f.rel), true)))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

function sha256File(abs, io = {}) {
  const h = crypto.createHash('sha256')
  h.update(readFileWithRetry(abs, io)) // réessai sur verrou transitoire
  return h.digest('hex')
}

// Corps canonique signé par le HMAC (déterministe).
function manifestBody(files, appVersion) {
  return JSON.stringify({
    algo: 'sha256',
    version: appVersion || '',
    files: files.map((f) => ({ rel: f.rel, sha256: f.sha256, size: f.size })),
  })
}

// ── Génération du manifeste (build : afterPack) ───────────────────────────────
function generateManifest(resourcesPath, appVersion) {
  const { getIntegrityKey } = require('./secure-key')
  const files = criticalFiles(resourcesPath).map((f) => ({
    rel: f.rel,
    sha256: sha256File(f.abs),
    size: fs.statSync(f.abs).size,
  }))
  const key = getIntegrityKey()
  const mac = crypto.createHmac('sha256', key).update(manifestBody(files, appVersion)).digest('hex')
  key.fill(0)
  return { algo: 'sha256', version: appVersion || '', createdAt: new Date().toISOString(), files, mac }
}

function writeManifest(resourcesPath, appVersion) {
  const manifest = generateManifest(resourcesPath, appVersion)
  fs.writeFileSync(path.join(resourcesPath, MANIFEST_NAME), JSON.stringify(manifest, null, 2))
  return manifest
}

// ── Vérification (runtime) ────────────────────────────────────────────────────
// Renvoie : { present, ok, violations:[], checked:number, reason? }
// `opts.io` (optionnel, pour les tests) = { readFile, sleep, retries, baseDelayMs }
// injecté dans les lectures avec réessai (verrous transitoires).
function verify(resourcesPath, opts = {}) {
  const io = opts.io || {}
  const manifestPath = path.join(resourcesPath, MANIFEST_NAME)
  if (!fs.existsSync(manifestPath)) {
    // Pas de manifeste (dev, ou build sans hook) → on ne bloque jamais.
    return { present: false, ok: true, violations: [], checked: 0 }
  }

  let manifest
  try {
    // Réessai : le manifeste peut lui aussi être momentanément verrouillé.
    manifest = JSON.parse(readFileWithRetry(manifestPath, io).toString('utf8'))
  } catch {
    return { present: true, ok: false, violations: ['manifest-unreadable'], checked: 0, reason: 'Manifeste illisible' }
  }

  // 1. Authenticité du manifeste (HMAC).
  const { getIntegrityKey } = require('./secure-key')
  const key = getIntegrityKey()
  const expectedMac = crypto.createHmac('sha256', key).update(manifestBody(manifest.files || [], manifest.version)).digest('hex')
  key.fill(0)
  const macOk =
    typeof manifest.mac === 'string' &&
    manifest.mac.length === expectedMac.length &&
    crypto.timingSafeEqual(Buffer.from(manifest.mac, 'hex'), Buffer.from(expectedMac, 'hex'))
  if (!macOk) {
    return { present: true, ok: false, violations: ['manifest-mac'], checked: 0, reason: 'Manifeste falsifié' }
  }

  // 2. Empreinte de chaque fichier listé. Les lectures réessaient sur verrou
  //    transitoire (sha256File → readFileWithRetry) : un `unreadable` ne subsiste
  //    donc qu'après épuisement des réessais (I/O réellement persistante), tandis
  //    qu'un `modified` (contenu altéré) est détecté immédiatement et sans merci.
  const violations = []
  let checked = 0
  for (const entry of manifest.files || []) {
    const abs = path.join(resourcesPath, entry.rel)
    if (!fs.existsSync(abs)) { violations.push(`missing:${entry.rel}`); continue }
    checked++
    let actual
    try { actual = sha256File(abs, io) } catch { violations.push(`unreadable:${entry.rel}`); continue }
    if (actual !== entry.sha256) violations.push(`modified:${entry.rel}`)
  }

  return { present: true, ok: violations.length === 0, violations, checked }
}

// ── Résolution du mode d'intégrité (PURE — testable) ──────────────────────────
//  Règle de sécurité : dans un build PACKAGÉ (production réelle, app.isPackaged),
//  l'intégrité est TOUJOURS appliquée en mode « enforce ». Aucune variable
//  d'environnement (GF_INTEGRITY_MODE, ELECTRON_DEV, …) ne peut la rétrograder
//  en « audit »/« off » : une tentative de rétrogradation est signalée
//  (downgradeIgnored) mais le mode reste « enforce ». Hors packagé (dev/test),
//  le mode est piloté par GF_INTEGRITY_MODE (défaut « off » : ne bloque pas le
//  développement), et peut être forcé à « enforce » pour les tests.
//
//  Renvoie : { mode:'enforce'|'audit'|'off', downgradeIgnored:boolean }
function resolveIntegrityMode({ isPackaged, requested }) {
  const req = String(requested || '').toLowerCase()
  const known = req === 'enforce' || req === 'audit' || req === 'off'
  if (isPackaged) {
    // Toute demande != enforce (ou inconnue) est ignorée par sécurité.
    const downgradeIgnored = req !== '' && req !== 'enforce'
    return { mode: 'enforce', downgradeIgnored }
  }
  return { mode: known ? req : 'off', downgradeIgnored: false }
}

// ── Détection best-effort d'un débogueur / inspecteur ─────────────────────────
function detectDebugger() {
  try {
    const inspector = require('inspector')
    if (typeof inspector.url === 'function' && inspector.url()) return true
  } catch { /* module absent → ignore */ }
  const argv = [...(process.execArgv || []), ...(process.argv || [])].join(' ')
  if (/--inspect(-brk|-port)?\b/.test(argv) || /--remote-debugging-port/.test(argv)) return true
  if (process.debugPort && process.env.GF_ALLOW_DEBUG !== '1' && /--inspect/.test(argv)) return true
  return false
}

module.exports = {
  MANIFEST_NAME,
  criticalFiles,
  sha256File,
  generateManifest,
  writeManifest,
  verify,
  resolveIntegrityMode,
  detectDebugger,
  // Exposés pour les tests de non-régression (faux positif de verrou transitoire).
  isTransientIoError,
  readFileWithRetry,
}

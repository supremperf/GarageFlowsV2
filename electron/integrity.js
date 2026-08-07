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
//  JAMAIS de fichier MUTABLE (base .db, .env, logs, cache, config utilisateur,
//  app-update.yml, standalone/**) : l'anti-tamper ne protège que les artefacts
//  applicatifs immuables — garanti par un test dédié.
//
//  ⚠️ Le GÉNÉRATEUR (build) et le VÉRIFICATEUR (runtime) partagent la MÊME
//  fonction de sélection (`criticalFiles`) : ils ne peuvent donc jamais diverger
//  sur l'ensemble des fichiers ni la résolution des chemins — pas de faux
//  positif dû à un décalage de chemins.
//
//  ⚠️ CAUSE RACINE du faux positif « installation corrompue » (corrigée ici) :
//  dans un build PACKAGÉ, Electron PATCHE le module `fs` pour présenter
//  app.asar comme un RÉPERTOIRE virtuel. `fs.readFileSync(".../app.asar")`
//  jette alors EISDIR (erreur NON transitoire → aucun réessai) → le fichier
//  était compté « unreadable » → blocage à CHAQUE lancement, installation
//  pourtant intacte. Le build (Node pur, fs non patché) et les tests ne
//  pouvaient pas le voir. CORRECTIF : toutes les E/S d'intégrité passent par
//  `original-fs` (le fs NON patché fourni par Electron) quand il existe —
//  on hache les OCTETS RÉELS du fichier app.asar, comme au build.
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

// ── fs BRUT (non patché asar) — testable ──────────────────────────────────────
//  Sous Electron, `original-fs` est le fs d'origine (app.asar = vrai fichier).
//  Sous Node pur (build electron-builder, vitest), le module n'existe pas →
//  repli sur `fs` (déjà non patché). `resolveRawFs` est pur et testé.
function resolveRawFs(requireFn) {
  try { return requireFn('original-fs') } catch { return fs }
}
const RAW_FS = resolveRawFs(require)

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
// Lecture par défaut : RAW_FS (fs NON patché asar — cf. cause racine ci-dessus).
function readFileWithRetry(abs, { readFile, sleep = sleepSync, retries = 4, baseDelayMs = 60 } = {}) {
  const read = readFile || ((p) => RAW_FS.readFileSync(p))
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return read(abs) }
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
  try { entries = RAW_FS.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, base, out)
    else if (e.isFile()) out.push({ rel: path.relative(base, abs).split(path.sep).join('/'), abs })
  }
}

// Renvoie la liste { rel, abs } des fichiers critiques présents sous resourcesPath.
// E/S via RAW_FS : sous Electron, app.asar est bien vu comme un FICHIER.
function criticalFiles(resourcesPath) {
  const out = []
  const push = (rel) => {
    const abs = path.join(resourcesPath, rel)
    if (RAW_FS.existsSync(abs) && RAW_FS.statSync(abs).isFile()) {
      out.push({ rel: rel.split(path.sep).join('/'), abs })
    }
  }
  push('app.asar')
  push('keys/public.pem')
  push('prisma/schema.prisma')

  const unpacked = path.join(resourcesPath, 'app.asar.unpacked')
  if (RAW_FS.existsSync(unpacked)) walk(unpacked, resourcesPath, out)

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
//  Le manifeste est produit à partir des ARTEFACTS FINAUX de resources/ : après
//  afterPack, plus AUCUN fichier couvert ne change (la signature éventuelle ne
//  modifie que le .exe, volontairement exclu ; NSIS installe les octets tels
//  quels). afterSign n'est PAS utilisable : electron-builder le SAUTE quand
//  aucune signature n'a lieu (build sans certificat) → le manifeste manquerait.
function generateManifest(resourcesPath, appVersion) {
  const { getIntegrityKey } = require('./secure-key')
  const files = criticalFiles(resourcesPath).map((f) => ({
    rel: f.rel,
    sha256: sha256File(f.abs),
    size: RAW_FS.statSync(f.abs).size,
  }))
  const key = getIntegrityKey()
  const mac = crypto.createHmac('sha256', key).update(manifestBody(files, appVersion)).digest('hex')
  key.fill(0)
  return { algo: 'sha256', version: appVersion || '', createdAt: new Date().toISOString(), files, mac }
}

function writeManifest(resourcesPath, appVersion) {
  const manifest = generateManifest(resourcesPath, appVersion)
  RAW_FS.writeFileSync(path.join(resourcesPath, MANIFEST_NAME), JSON.stringify(manifest, null, 2))
  return manifest
}

// ── Vérification (runtime) ────────────────────────────────────────────────────
// Renvoie : { present, ok, violations:[], details:[], checked:number, reason? }
//  - violations : codes courts historiques ('modified:rel', 'missing:rel', …)
//  - details    : diagnostic COMPLET par échec :
//      { rel, absPath, reason: 'MISSING'|'SIZE_MISMATCH'|'HASH_MISMATCH'|
//        'UNREADABLE'|'MANIFEST_INVALID'|'MANIFEST_MAC_INVALID',
//        expectedSha256, actualSha256, expectedSize, actualSize }
// `opts.io` (optionnel, pour les tests) = { readFile, sleep, retries, baseDelayMs }.
function verify(resourcesPath, opts = {}) {
  const io = opts.io || {}
  const manifestPath = path.join(resourcesPath, MANIFEST_NAME)
  if (!RAW_FS.existsSync(manifestPath)) {
    // Pas de manifeste (dev, ou build sans hook) → on ne bloque jamais ici ;
    // c'est l'appelant (mode enforce) qui décide.
    return { present: false, ok: true, violations: [], details: [], checked: 0 }
  }

  let manifest
  try {
    // Réessai : le manifeste peut lui aussi être momentanément verrouillé.
    manifest = JSON.parse(readFileWithRetry(manifestPath, io).toString('utf8'))
  } catch {
    return {
      present: true, ok: false, violations: ['manifest-unreadable'], checked: 0,
      reason: 'Manifeste illisible',
      details: [{ rel: MANIFEST_NAME, absPath: manifestPath, reason: 'MANIFEST_INVALID', expectedSha256: null, actualSha256: null, expectedSize: null, actualSize: null }],
    }
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
    return {
      present: true, ok: false, violations: ['manifest-mac'], checked: 0,
      reason: 'Manifeste falsifié',
      details: [{ rel: MANIFEST_NAME, absPath: manifestPath, reason: 'MANIFEST_MAC_INVALID', expectedSha256: null, actualSha256: null, expectedSize: null, actualSize: null }],
    }
  }

  // 2. Empreinte de chaque fichier listé. Les lectures réessaient sur verrou
  //    transitoire (sha256File → readFileWithRetry, via RAW_FS non patché asar) :
  //    un `unreadable` ne subsiste qu'après épuisement des réessais (I/O
  //    réellement persistante), tandis qu'un contenu altéré est détecté
  //    immédiatement (taille puis empreinte) et sans merci.
  const violations = []
  const details = []
  let checked = 0
  for (const entry of manifest.files || []) {
    const abs = path.join(resourcesPath, entry.rel)
    if (!RAW_FS.existsSync(abs)) {
      violations.push(`missing:${entry.rel}`)
      details.push({ rel: entry.rel, absPath: abs, reason: 'MISSING', expectedSha256: entry.sha256 ?? null, actualSha256: null, expectedSize: entry.size ?? null, actualSize: null })
      continue
    }
    checked++
    // Taille d'abord (peu coûteux, diagnostic plus précis qu'un hash différent).
    let actualSize = null
    try { actualSize = RAW_FS.statSync(abs).size } catch { /* stat refusée → le hash tranchera */ }
    if (actualSize != null && entry.size != null && actualSize !== entry.size) {
      violations.push(`modified:${entry.rel}`)
      details.push({ rel: entry.rel, absPath: abs, reason: 'SIZE_MISMATCH', expectedSha256: entry.sha256 ?? null, actualSha256: null, expectedSize: entry.size, actualSize })
      continue
    }
    let actual
    try { actual = sha256File(abs, io) } catch {
      violations.push(`unreadable:${entry.rel}`)
      details.push({ rel: entry.rel, absPath: abs, reason: 'UNREADABLE', expectedSha256: entry.sha256 ?? null, actualSha256: null, expectedSize: entry.size ?? null, actualSize })
      continue
    }
    if (actual !== entry.sha256) {
      violations.push(`modified:${entry.rel}`)
      details.push({ rel: entry.rel, absPath: abs, reason: 'HASH_MISMATCH', expectedSha256: entry.sha256 ?? null, actualSha256: actual, expectedSize: entry.size ?? null, actualSize })
    }
  }

  return { present: true, ok: violations.length === 0, violations, details, checked }
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
  // Exposés pour les tests de non-régression.
  isTransientIoError,
  readFileWithRetry,
  resolveRawFs,
}

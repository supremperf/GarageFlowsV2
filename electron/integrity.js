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

function sha256File(abs) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(abs))
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
function verify(resourcesPath) {
  const manifestPath = path.join(resourcesPath, MANIFEST_NAME)
  if (!fs.existsSync(manifestPath)) {
    // Pas de manifeste (dev, ou build sans hook) → on ne bloque jamais.
    return { present: false, ok: true, violations: [], checked: 0 }
  }

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
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

  // 2. Empreinte de chaque fichier listé.
  const violations = []
  let checked = 0
  for (const entry of manifest.files || []) {
    const abs = path.join(resourcesPath, entry.rel)
    if (!fs.existsSync(abs)) { violations.push(`missing:${entry.rel}`); continue }
    checked++
    let actual
    try { actual = sha256File(abs) } catch { violations.push(`unreadable:${entry.rel}`); continue }
    if (actual !== entry.sha256) violations.push(`modified:${entry.rel}`)
  }

  return { present: true, ok: violations.length === 0, violations, checked }
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
  detectDebugger,
}

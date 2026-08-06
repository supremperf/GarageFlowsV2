#!/usr/bin/env node
/**
 * check-branding.mjs — garde-fou de marque (CI).
 *
 * La marque VISIBLE par l'utilisateur doit être « GarageFlows » (pluriel).
 * Ce script échoue si une occurrence VISIBLE de l'ancien nom « GarageFlow »
 * (singulier, CamelCase) réapparaît hors de la liste d'exclusions documentée.
 *
 * Il vérifie aussi :
 *   - la cohérence des manifestes (name / short_name = GarageFlows) ;
 *   - l'EXISTENCE réelle de chaque icône référencée par un manifeste.
 *
 * Les exclusions sont PRÉCISES (jamais un dossier entier) et JUSTIFIÉES : ce sont
 * des identifiants techniques, des noms d'artefacts (exe/installeur), des sels
 * cryptographiques, ou des libellés qui désignent l'identité d'installation
 * Windows (productName = « GarageFlow », conservé pour ne pas casser les
 * installations/mises à jour existantes). Voir docs/PRODUCTION-READINESS.md.
 *
 * Usage : node scripts/check-branding.mjs        (échoue en cas de violation)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCAN_DIRS = ['src', 'public', 'electron']
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.webmanifest', '.css'])

// ── Jetons TECHNIQUES autorisés (jamais « visibles » comme marque) ───────────
// Chaque motif est justifié : renommer casserait un identifiant, un artefact,
// une identité OS/HTTP ou du matériel cryptographique.
const ALLOWED_TOKENS = [
  /GarageFlows/,                    // déjà la cible correcte (pluriel)
  /GarageFlowLogo/,                 // identifiant de composant React
  /GarageFlowIcon/,                 // identifiant de composant React
  /GarageFlow\.exe/,                // nom d'exécutable (productName)
  /GarageFlow[- ]Setup/,            // nom d'installeur (productName)
  /GarageFlow&nbsp;Setup/,          // idem (HTML)
  /GarageFlow_Export_/,             // dossier d'export (artefact fichier)
  /GarageFlow-server/,              // serviceName Electron (identité OS)
  /GarageFlow\//,                   // User-Agent HTTP
  /GarageFlow-License-Storage-Salt/,// sel de chiffrement (KDF) — NE PAS changer
  /GarageFlow-DB-MAC-Salt/,         // sel de MAC base — NE PAS changer
  /GarageFlow::v2::kdf/,            // sel KDF secure-key — NE PAS changer
  /GarageFlow-KeygenGUI/,           // User-Agent keygen (compat control-plane)
]

// ── Exclusions EXPLICITES (libellé qui désigne l'identité d'installation) ────
// Repérées par une sous-chaîne distinctive → robustes aux décalages de lignes.
const EXPLICIT_EXCLUSIONS = [
  { file: 'electron/main.js', needle: 'Base de données manquante', reason: 'dialogue « réinstaller » : identité Windows productName' },
  { file: 'electron/main.js', needle: 'désinstallez GarageFlow', reason: 'instruction de désinstallation = entrée Windows productName' },
  { file: 'electron/main.js', needle: 'installation corrompue', reason: 'dialogue intégrité : identité produit installé' },
  { file: 'electron/main.js', needle: 'fichiers essentiels de GarageFlow', reason: 'dialogue intégrité : identité produit installé' },
  { file: 'electron/main.js', needle: 'réinstaller GarageFlow', reason: 'instruction de réinstallation = installeur productName' },
  { file: 'electron/main.js', needle: "log('GarageFlow v'", reason: 'log interne de démarrage (non visible UI)' },
  { file: 'electron/update-verify.js', needle: "EXPECTED_PRODUCT = 'GarageFlow'", reason: 'doit correspondre au champ « product » du flux de MàJ' },
  { file: 'src/lib/__tests__/update-verify.test.ts', needle: "product: 'GarageFlow'", reason: "reflète l'identité « product » du flux de MàJ (voir EXPECTED_PRODUCT)" },
]

/** Retire les commentaires évidents d'une ligne (heuristique de scan de marque). */
function stripComments(line) {
  const t = line.trimStart()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return ''
  // commentaire de fin de ligne « // … » (naïf, suffisant pour la détection)
  const idx = line.indexOf('//')
  if (idx >= 0 && !/https?:$/.test(line.slice(0, idx + 1))) return line.slice(0, idx)
  return line
}

function isAllowedAt(line, matchIndex) {
  // Un contexte est autorisé si l'occurrence appartient à un jeton technique.
  for (const re of ALLOWED_TOKENS) {
    const g = new RegExp(re.source, 'g')
    let m
    while ((m = g.exec(line))) {
      if (matchIndex >= m.index && matchIndex < m.index + m[0].length) return true
    }
  }
  return false
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (SCAN_EXT.has(extname(entry))) out.push(p)
  }
}

const violations = []
const files = []
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d)
  if (existsSync(abs)) walk(abs, files)
}

const BRAND = /GarageFlow(?!s)/g
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((rawLine, i) => {
    const line = stripComments(rawLine)
    let m
    BRAND.lastIndex = 0
    while ((m = BRAND.exec(line))) {
      if (isAllowedAt(line, m.index)) continue
      const excluded = EXPLICIT_EXCLUSIONS.some(
        (e) => rel === e.file && rawLine.includes(e.needle),
      )
      if (excluded) continue
      violations.push({ file: rel, line: i + 1, text: rawLine.trim().slice(0, 120) })
    }
  })
}

// ── Vérification des manifestes ──────────────────────────────────────────────
const manifestIssues = []
for (const mf of ['public/manifest.webmanifest', 'public/site.webmanifest']) {
  const abs = join(ROOT, mf)
  if (!existsSync(abs)) continue
  let json
  try { json = JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { manifestIssues.push(`${mf}: JSON invalide (${e.message})`); continue }
  if (json.name && !String(json.name).includes('GarageFlows')) manifestIssues.push(`${mf}: name="${json.name}" ne contient pas « GarageFlows »`)
  if (json.short_name && json.short_name !== 'GarageFlows') manifestIssues.push(`${mf}: short_name="${json.short_name}" ≠ « GarageFlows »`)
  for (const ic of json.icons ?? []) {
    const iconPath = join(ROOT, 'public', String(ic.src).replace(/^\//, ''))
    if (!existsSync(iconPath)) manifestIssues.push(`${mf}: icône absente sur le disque → ${ic.src}`)
  }
}

// ── Rapport ───────────────────────────────────────────────────────────────
let failed = false
if (violations.length) {
  failed = true
  console.error(`\n❌ Marque : ${violations.length} occurrence(s) VISIBLE(s) de « GarageFlow » (singulier) hors exclusions :`)
  for (const v of violations) console.error(`   ${v.file}:${v.line}  ${v.text}`)
  console.error('\n   → Corrigez en « GarageFlows », ou ajoutez une exclusion JUSTIFIÉE dans scripts/check-branding.mjs.')
}
if (manifestIssues.length) {
  failed = true
  console.error(`\n❌ Manifestes : ${manifestIssues.length} problème(s) :`)
  for (const m of manifestIssues) console.error(`   ${m}`)
}

if (failed) {
  console.error('\nÉchec du contrôle de marque.\n')
  process.exit(1)
}
console.log(`✅ Marque cohérente : « GarageFlows » partout dans le visible (${files.length} fichiers scannés). Manifestes et icônes OK.`)

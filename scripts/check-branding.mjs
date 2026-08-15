#!/usr/bin/env node
/**
 * check-branding.mjs — garde-fou de marque STRICT (CI).
 *
 * La marque VISIBLE de l'application (« GarageFlows », pluriel) doit être uniforme.
 * Ce script échoue si une occurrence CamelCase « GarageFlow » (non suivie de « s »)
 * apparaît dans le RUNTIME EXPÉDIÉ (src/, public/, electron/) HORS d'une exception
 * TECHNIQUE précisément documentée.
 *
 * PRINCIPES (durcis) :
 *   - aucune exclusion de dossier entier ; aucune expression régulière « fourre-tout » ;
 *   - chaque exception cible un IDENTIFIANT technique précis (motif étroit) OU un
 *     couple exact {fichier, sous-chaîne} avec justification ;
 *   - une occurrence VISIBLE non documentée fait ÉCHOUER la CI ;
 *   - la liste exacte des exceptions est AFFICHÉE (transparence).
 *
 * Périmètre = TOUT le dépôt utile : runtime expédié (src, public, electron),
 * scripts (CMD/PS1/Python — keygen inclus), prisma, .github et fichiers racine
 * (README, CHANGELOG, package.json…). Les rapports HISTORIQUES (marqueur
 * `doc-status: historique`) sont hors périmètre : ils documentent d'anciennes
 * versions et l'affichent en bandeau.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
// Périmètre COMPLET : runtime expédié + racine + scripts + prisma + CI.
// Aucun dossier n'est exclu en bloc ; les rapports HISTORIQUES (marqueur
// `doc-status: historique`) sont ignorés car ils documentent d'anciennes versions.
const SCAN_DIRS = ['src', 'public', 'electron', 'scripts', 'prisma', '.github']
const ROOT_FILES = ['README.md', 'CHANGELOG.md', 'CONFIGURER-GARAGEFLOW.cmd', 'package.json', 'AUDIT_RAPPORT.md', 'AUDIT_TRACKER.md', 'FINAL_ENTERPRISE_READINESS_REPORT.md', 'FINAL_UNIFIED_GARAGEFLOW_REPORT.md']
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.webmanifest', '.css', '.md', '.cmd', '.ps1', '.py', '.yml', '.yaml', '.json', '.prisma'])

// ── Motifs d'IDENTIFIANTS techniques autorisés (ÉTROITS, jamais « visibles ») ──
// Chacun ne matche qu'un jeton technique précis ; renommer casserait le code,
// l'OS/HTTP ou du matériel cryptographique. Justification par entrée.
const IDENTIFIER_PATTERNS = [
  { re: /GarageFlow(Logo|Icon)\b/, why: 'identifiant de composant React (GarageFlowLogo/Icon)' },
  { re: /GarageFlow-server\b/, why: 'serviceName Electron (keytar/identité OS)' },
  { re: /GarageFlow\/[0-9']/, why: "User-Agent HTTP « GarageFlow/<version> »" },
  { re: /GarageFlow-License-Storage-Salt/, why: 'sel de chiffrement (KDF) — NE PAS changer' },
  { re: /GarageFlow-DB-MAC-Salt/, why: 'sel de MAC base — NE PAS changer' },
  { re: /GarageFlow::v2::kdf/, why: 'sel KDF secure-key — NE PAS changer' },
  { re: /GarageFlow-KeygenGUI/, why: 'User-Agent keygen (compat control-plane)' },
  { re: /%APPDATA%\\GarageFlow\b/, why: 'dossier de données HISTORIQUE Windows (compat installations)' },
  { re: /Software\\GarageFlow\b/, why: 'clé de registre historique (compat installations)' },
  { re: /'GarageFlow'\)$|, 'GarageFlow'\)/, why: "chemin du dossier de données historique (restore.js / userData pin)" },
  { re: /appData'\), 'GarageFlow'/, why: 'épinglage userData historique (main.js)' },
]

// ── Exceptions EXPLICITES {fichier, sous-chaîne, raison} (couples exacts) ──────
const EXPLICIT_EXCLUSIONS = [
  { file: 'electron/main.js', needle: "app.getPath('appData'), 'GarageFlow'", reason: "épinglage du dossier userData historique — préserve BD/licence/secret des installs existantes" },
  { file: 'electron/update-verify.js', needle: "EXPECTED_PRODUCT = 'GarageFlow'", reason: 'doit correspondre au champ « product » du flux de MàJ (identité interne, non visible)' },
  { file: 'src/lib/__tests__/update-verify.test.ts', needle: "product: 'GarageFlow'", reason: "reflète l'identité « product » du flux de MàJ (voir EXPECTED_PRODUCT)" },
  { file: 'src/integration/publication-mise-a-jour.test.ts', needle: "product: 'GarageFlow'", reason: "manifeste de test de PUBLICATION : le champ « product » doit valoir EXPECTED_PRODUCT, sinon le poste rejette la mise à jour — écrire « GarageFlows » ici ferait affirmer au test un contrat que la production refuse" },
  { file: 'scripts/sign-release-manifest.mjs', needle: "PRODUIT = 'GarageFlow'", reason: 'le manifeste signé DOIT porter la même identité « product » que EXPECTED_PRODUCT, sinon chaque poste rejette la mise à jour (identité interne, non visible)' },
  { file: 'electron/user-data-path.js', needle: "LEGACY_DATA_DIR_NAME = 'GarageFlow'", reason: 'nom du dossier de données HISTORIQUE — compat installations existantes' },
  { file: 'src/lib/__tests__/user-data-path.test.ts', needle: "toBe('GarageFlow')", reason: 'assertion de compat : le dossier historique ne doit JAMAIS être renommé' },
  { file: 'src/lib/__tests__/user-data-path.test.ts', needle: "dossier HISTORIQUE GarageFlow", reason: 'intitulé du test de compat du dossier historique' },
]

/** Retire les commentaires évidents (heuristique de scan de marque). */
function stripComments(line, ext) {
  const t = line.trimStart()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return ''
  // Commentaires « # … » (Python / PowerShell / YAML) et « :: » / « rem » (CMD).
  if ((ext === '.py' || ext === '.ps1' || ext === '.yml' || ext === '.yaml') && t.startsWith('#')) return ''
  if (ext === '.cmd' && (t.startsWith('::') || /^rem\s/i.test(t))) return ''
  let out = line
  // Markdown : le CODE (spans `…` et identifiants techniques documentés) n'est
  // pas de la marque visible — on retire les spans inline.
  if (ext === '.md') out = out.replace(/`[^`]*`/g, '')
  // Commentaire JSX {/* ... */} sur une ligne.
  out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  // Commentaire /* ... */ inline.
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  // Commentaire de fin de ligne « // … » (hors URL http://).
  const idx = out.indexOf('//')
  if (idx >= 0 && !/https?:$/.test(out.slice(0, idx + 1))) out = out.slice(0, idx)
  return out
}

function classify(line, matchIndex, relFile, rawLine) {
  for (const p of IDENTIFIER_PATTERNS) {
    const g = new RegExp(p.re.source, 'g')
    let m
    while ((m = g.exec(line))) {
      if (matchIndex >= m.index && matchIndex < m.index + m[0].length) return p.why
    }
  }
  for (const e of EXPLICIT_EXCLUSIONS) {
    if (relFile === e.file && rawLine.includes(e.needle)) return e.reason
  }
  return null
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

const files = []
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d)
  if (existsSync(abs)) walk(abs, files)
}
for (const f of ROOT_FILES) {
  const abs = join(ROOT, f)
  if (existsSync(abs)) files.push(abs)
}

const BRAND = /GarageFlow(?!s)/g
const violations = []
const usedExceptions = new Map()
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  const ext = '.' + (rel.split('.').pop() ?? '')
  const text = readFileSync(file, 'utf8')
  // Rapports HISTORIQUES : documentent d'anciennes versions — hors périmètre.
  if (text.includes('doc-status: historique')) continue
  let inFence = false
  text.split('\n').forEach((rawLine, i) => {
    if (ext === '.md') {
      if (rawLine.trimStart().startsWith('```')) { inFence = !inFence; return }
      if (inFence) return // bloc de code markdown = technique, pas de marque visible
    }
    const line = stripComments(rawLine, ext)
    // La marque VISIBLE peut être coupée par une balise : « Garage<span>Flow</span> »
    // s'affiche « GarageFlow » à l'écran alors qu'aucune occurrence contiguë
    // n'existe dans la source. C'est ce qui avait laissé passer le titre du splash,
    // la fenêtre d'activation, l'en-tête de l'application (donc TOUS les écrans)
    // et trois pages PWA. On teste donc aussi la ligne débarrassée de ses balises.
    const candidates = [line]
    if (ext === '.html' || ext === '.tsx' || ext === '.jsx') {
      const visible = line.replace(/<[^>]*>/g, '')
      if (visible !== line) candidates.push(visible)
    }
    const seen = new Set()
    for (const candidate of candidates) {
      let m
      BRAND.lastIndex = 0
      while ((m = BRAND.exec(candidate))) {
        const why = classify(candidate, m.index, rel, rawLine)
        if (why) {
          const key = `${rel} — ${why}`
          usedExceptions.set(key, (usedExceptions.get(key) ?? 0) + 1)
        } else if (!seen.has(i)) {
          // une seule violation par ligne, quelle que soit la variante détectée
          seen.add(i)
          violations.push({ file: rel, line: i + 1, text: rawLine.trim().slice(0, 120) })
        }
      }
    }
  })
}

// Contrôle de marque des manifestes (name/short_name). Dimensions d'icônes → check-pwa.
const manifestIssues = []
for (const mf of ['public/manifest.webmanifest', 'public/site.webmanifest']) {
  const abs = join(ROOT, mf)
  if (!existsSync(abs)) continue
  try {
    const j = JSON.parse(readFileSync(abs, 'utf8'))
    if (j.name && !String(j.name).includes('GarageFlows')) manifestIssues.push(`${mf}: name="${j.name}" sans « GarageFlows »`)
    if (j.short_name && j.short_name !== 'GarageFlows') manifestIssues.push(`${mf}: short_name="${j.short_name}" ≠ « GarageFlows »`)
  } catch (e) { manifestIssues.push(`${mf}: JSON invalide (${e.message})`) }
}

// ── Rapport ───────────────────────────────────────────────────────────────
console.log(`Marque — exceptions techniques ACTIVES (précises, documentées) :`)
for (const [k, n] of [...usedExceptions.entries()].sort()) console.log(`   • ${k}  (${n})`)
if (usedExceptions.size === 0) console.log('   (aucune)')

let failed = false
if (violations.length) {
  failed = true
  console.error(`\n❌ ${violations.length} occurrence(s) VISIBLE(s) « GarageFlow » hors exception :`)
  for (const v of violations) console.error(`   ${v.file}:${v.line}  ${v.text}`)
  console.error('\n   → Corrigez en « GarageFlows », ou ajoutez une exception PRÉCISE (fichier+clé+raison).')
}
if (manifestIssues.length) {
  failed = true
  console.error(`\n❌ Manifestes :`)
  for (const m of manifestIssues) console.error(`   ${m}`)
}
if (failed) { console.error('\nÉchec du contrôle de marque.\n'); process.exit(1) }
console.log(`\n✅ Marque cohérente : « GarageFlows » dans tout le visible (${files.length} fichiers). Exceptions techniques uniquement.`)

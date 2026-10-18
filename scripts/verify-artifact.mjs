#!/usr/bin/env node
/**
 * verify-artifact — vérifie qu'un ARTEFACT DE DISTRIBUTION extrait est cohérent et
 * rattachable à son code source, SANS exiger `.git`.
 *
 * Deux modes (auto-détectés) :
 *   • Repository : `.git` présent → on vérifie EN PLUS que le commit du manifeste
 *     == HEAD (anti-manifeste périmé).
 *   • Artifact : pas de `.git` (ZIP extrait chez l'acquéreur) → on se fie au
 *     `release-manifest.json` embarqué comme source d'identité.
 *
 * Contrôles (les deux modes) :
 *   1. release-manifest.json présent, JSON valide, champs d'identité requis ;
 *   2. package.json.version == manifest.packageVersion (pas de contradiction) ;
 *   3. commit du manifeste = 40 hex (identité de build présente) ;
 *   4. AUCUN .env / .env.* embarqué (fuite de secrets) — racine + standalone ;
 *   5. fichiers critiques présents (clé publique de licence, schéma Prisma).
 *
 * Sort 0 si tout passe, 1 sinon. Aucune valeur secrète n'est affichée.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_MANIFEST_FIELDS = ['productName', 'packageVersion', 'buildId', 'git', 'generatedAt']
const errors = []
const notes = []

function fail(msg) { errors.push(msg) }
function ok(msg) { notes.push(msg) }

// 1. Manifeste
const manifestPath = path.join(ROOT, 'release-manifest.json')
let manifest = null
if (!existsSync(manifestPath)) {
  fail('release-manifest.json ABSENT — l\'artefact n\'est pas rattachable à un build (générer via `npm run release:manifest` et l\'inclure dans le paquet).')
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const f of REQUIRED_MANIFEST_FIELDS) {
      if (manifest[f] === undefined || manifest[f] === null) fail(`release-manifest.json : champ requis manquant « ${f} ».`)
    }
    ok(`Manifeste présent : ${manifest.productName} ${manifest.packageVersion} (build ${manifest.buildId}).`)
  } catch (e) {
    fail(`release-manifest.json illisible : ${e.message}`)
  }
}

// 2. Cohérence version manifeste ↔ package.json
try {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  if (manifest && manifest.packageVersion && pkg.version && manifest.packageVersion !== pkg.version) {
    fail(`Version incohérente : manifest ${manifest.packageVersion} ≠ package.json ${pkg.version}.`)
  } else if (manifest && pkg.version) {
    ok(`Version cohérente manifest ↔ package.json (${pkg.version}).`)
  }
} catch (e) { fail(`package.json illisible : ${e.message}`) }

// 3. Identité de commit
const commit = manifest && manifest.git && manifest.git.commit
if (manifest && (!commit || !/^[0-9a-f]{40}$/.test(commit))) {
  fail('release-manifest.json : git.commit absent ou non conforme (40 hex attendu).')
} else if (commit) {
  ok(`Commit de build : ${commit.slice(0, 9)}${manifest.git.dirty ? ' (arbre modifié au build)' : ''}.`)
}

// 3bis. Mode repository : commit du manifeste == HEAD
if (existsSync(path.join(ROOT, '.git')) && commit) {
  try {
    const { execFileSync } = await import('node:child_process')
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    if (head !== commit) fail(`Mode repository : commit manifeste ${commit.slice(0,9)} ≠ HEAD ${head.slice(0,9)} (manifeste périmé — régénérer).`)
    else ok('Mode repository : commit manifeste == HEAD.')
  } catch { notes.push('Mode repository : HEAD indéterminé (git indisponible) — contrôle sauté.') }
} else {
  ok('Mode artifact : identité lue depuis le manifeste (pas de .git requis).')
}

// 4. Aucune fuite .env dans l'ARTEFACT distribué.
//    - Les modèles `.env.example|sample|template` sont des gabarits SANS secret → jamais signalés.
//    - Le `.env` de DÉVELOPPEMENT à la racine du dépôt est légitime (gitignored, non distribué) :
//      on ne le signale QU'EN mode artifact (ZIP extrait, sans .git), là où sa présence
//      signifierait une vraie fuite.
//    - Dans le standalone/resources EMPAQUETÉ, tout `.env` réel est TOUJOURS une fuite.
const isRepo = existsSync(path.join(ROOT, '.git'))
const isEnvTemplate = (n) => /^\.env\.(example|sample|template)$/.test(n)
const isRealEnv = (n) => (n === '.env' || n.startsWith('.env.')) && !isEnvTemplate(n)
const scanDirs = [
  { dir: path.join(ROOT, '.next', 'standalone'), always: true },
  { dir: path.join(ROOT, 'resources', 'standalone'), always: true },
  { dir: path.join(ROOT, 'standalone'), always: true },
  { dir: ROOT, always: false }, // racine : uniquement en mode artifact
]
let envLeaks = 0
for (const { dir, always } of scanDirs) {
  if (!existsSync(dir)) continue
  if (!always && isRepo) continue // .env de dev à la racine = légitime en mode repository
  for (const name of readdirSync(dir)) {
    if (isRealEnv(name) && statSync(path.join(dir, name)).isFile()) {
      fail(`Fuite de secrets : ${path.relative(ROOT, path.join(dir, name)) || name} présent dans l'artefact.`)
      envLeaks++
    }
  }
}
if (!envLeaks) ok('Aucun .env réel embarqué (gabarits .env.example ignorés).')

// 5. Fichiers critiques
const critical = [
  ['src/lib/license/public-key.ts', 'clé publique de licence'],
  ['prisma/schema.prisma', 'schéma Prisma desktop'],
]
for (const [rel, label] of critical) {
  if (existsSync(path.join(ROOT, rel))) ok(`Fichier critique présent : ${rel} (${label}).`)
  else fail(`Fichier critique ABSENT : ${rel} (${label}).`)
}

// ── Rapport ───────────────────────────────────────────────────────────────────
console.log('── Vérification de l\'artefact GarageFlows ──')
for (const n of notes) console.log('  ✓', n)
if (errors.length) {
  console.error('\n❌ Artefact NON conforme :')
  for (const e of errors) console.error('  •', e)
  process.exit(1)
}
console.log('\n✅ Artefact conforme et rattachable à son build.')

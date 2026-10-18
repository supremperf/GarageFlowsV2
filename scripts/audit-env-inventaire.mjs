/**
 * INVENTAIRE EXHAUSTIF des variables d'environnement du dépôt (LECTURE SEULE).
 *
 * Recense TOUTES les formes d'accès, pas seulement `process.env.X` :
 *   process.env.X · process.env['X'] · env("X") (Prisma/Zod) · import.meta.env.X
 *   $env:X (PowerShell) · %X% (cmd) · ${{ secrets.X }} (GitHub) · X= (.env)
 *
 * Classe chaque occurrence par NATURE de fichier (code applicatif, script,
 * schéma Prisma, CI, fichier .env, documentation), car la portée d'une
 * correction n'est pas la même : un rapport historique cite légitimement un
 * ancien nom, un consommateur actif non.
 *
 * Aucune VALEUR n'est jamais lue ni affichée — uniquement des NOMS.
 */
import fs from 'node:fs'
import path from 'node:path'

const RACINE = process.cwd()
const IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'out', 'coverage', 'artifacts',
  '__pycache__', '.vercel', 'server-client', '.turbo', 'playwright-report',
])
const EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.prisma',
  '.yml', '.yaml', '.md', '.ps1', '.sh', '.cmd', '.bat', '.env', '.example',
])

/** Nature d'un fichier — détermine la portée d'une éventuelle correction. */
function nature(rel) {
  const p = rel.replace(/\\/g, '/')
  if (/^\.env/.test(path.basename(p))) return 'env-file'
  if (p.startsWith('.github/')) return 'ci'
  if (p.startsWith('prisma/')) return 'prisma'
  if (p.startsWith('scripts/')) return 'script'
  if (p.startsWith('electron/')) return 'electron'
  if (p.startsWith('docs/') || p.endsWith('.md')) return 'doc'
  if (/\.(test|spec)\.[tj]sx?$/.test(p) || p.includes('/__tests__/') || p.startsWith('e2e/')) return 'test'
  if (p.startsWith('src/')) return 'app'
  return 'autre'
}

const MOTIFS = [
  [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, 1],
  [/process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g, 1],
  [/\benv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g, 1],
  [/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, 1],
  [/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, 1],
  [/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g, 1],
  [/\$\{\{\s*(?:secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, 1],
]

/** Déclarations dans un fichier .env* : NOM= (la valeur n'est jamais lue). */
const MOTIF_ENV_FILE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm

/** Mentions en documentation : un NOM_MAJUSCULE isolé, pour repérer les alias. */
const MOTIF_DOC = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,6})\b/g

/** Faux positifs fréquents en doc/CI : mots en capitales qui ne sont pas des variables. */
const NON_VARIABLES = new Set([
  'NON_TESTE', 'NOT_NULL', 'IF_NOT', 'ON_DELETE', 'ON_UPDATE', 'SET_NULL',
  'PRIMARY_KEY', 'FOREIGN_KEY', 'CREATE_TABLE', 'ADD_COLUMN', 'DROP_COLUMN',
  'PRODUCTION_READY', 'FIXED_NOT', 'NOT_FULLY', 'FULLY_VERIFIED',
  'US_EAST', 'GF_DUR', 'HTTP_CODE', 'NO_STORE', 'CACHE_CONTROL', 'USER_AGENT',
  'TEST_URL', 'DB_PATH', 'RACINE_DONNEES', 'OK_UNKNOWN', 'LOG_LEVELS',
  'SELECT_1', 'A_B', 'B_C',
])

function* parcourir(dir) {
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item)
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (!IGNORE_DIRS.has(item)) yield* parcourir(p)
    } else {
      const base = path.basename(p)
      if (EXTS.has(path.extname(p)) || /^\.env/.test(base)) yield p
    }
  }
}

/** nom → { total, parNature: Map, fichiers: Set } */
const registre = new Map()
const noter = (nom, nat, rel) => {
  if (!registre.has(nom)) registre.set(nom, { total: 0, parNature: new Map(), fichiers: new Set() })
  const e = registre.get(nom)
  e.total++
  e.parNature.set(nat, (e.parNature.get(nat) ?? 0) + 1)
  e.fichiers.add(rel)
}

let nbFichiers = 0
for (const f of parcourir(RACINE)) {
  const rel = path.relative(RACINE, f).replace(/\\/g, '/')
  let texte
  try { texte = fs.readFileSync(f, 'utf8') } catch { continue }
  nbFichiers++
  const nat = nature(rel)

  if (nat === 'env-file') {
    for (const m of texte.matchAll(MOTIF_ENV_FILE)) noter(m[1], nat, rel)
    continue
  }

  for (const [re, idx] of MOTIFS) for (const m of texte.matchAll(re)) noter(m[idx], nat, rel)

  // La documentation ne « lit » pas de variable : on repère les MENTIONS, qui
  // sont la principale source d'alias fantômes recopiés par un humain.
  if (nat === 'doc') {
    for (const m of texte.matchAll(MOTIF_DOC)) {
      const n = m[1]
      if (NON_VARIABLES.has(n) || n.length < 5) continue
      noter(n, 'doc-mention', rel)
    }
  }
}

// ── Sortie ────────────────────────────────────────────────────────────────────
const noms = [...registre.keys()].sort()
const actifs = noms.filter((n) => {
  const nat = registre.get(n).parNature
  return ['app', 'script', 'prisma', 'electron', 'ci', 'test'].some((k) => nat.has(k))
})

console.log(`${nbFichiers} fichiers analysés · ${noms.length} noms distincts · ${actifs.length} lus par du code\n`)

const NATURES = ['app', 'prisma', 'electron', 'script', 'ci', 'test', 'env-file', 'autre']
// Une MENTION en documentation ne prouve pas l'existence d'une variable : le
// motif ramasse aussi des statuts et des titres de rapports. On ne retient donc
// comme variable QUE ce qu'un fichier exécutable lit ou qu'un .env déclare ; la
// documentation ne sert plus qu'à annoter ces noms-là.
const estPertinent = (n) => NATURES.some((k) => registre.get(n).parNature.has(k))
const pertinents = noms.filter(estPertinent)
const TOUT = process.argv.includes('--tout')
const affiches = TOUT ? noms : pertinents

console.log(`${pertinents.length} noms retenus (lus par du code ou déclarés dans un .env)`)
console.log(`${noms.length - pertinents.length} noms écartés : mentions de documentation uniquement\n`)

console.log('NOM'.padEnd(38) + NATURES.map((n) => n.slice(0, 5).padStart(6)).join('') + '   doc  fich.')
console.log('─'.repeat(38 + NATURES.length * 6 + 13))
for (const n of affiches) {
  const e = registre.get(n)
  const cols = NATURES.map((nat) => String(e.parNature.get(nat) ?? '').padStart(6)).join('')
  const doc = String((e.parNature.get('doc') ?? 0) + (e.parNature.get('doc-mention') ?? 0) || '').padStart(5)
  console.log(n.padEnd(38) + cols + doc + String(e.fichiers.size).padStart(7))
}

// ── Fichier machine, pour les étapes suivantes ────────────────────────────────
const sortie = {}
for (const n of noms) {
  const e = registre.get(n)
  sortie[n] = {
    total: e.total,
    natures: Object.fromEntries(e.parNature),
    fichiers: [...e.fichiers].sort(),
  }
}
fs.mkdirSync('artifacts/verification/env', { recursive: true })
fs.writeFileSync('artifacts/verification/env/inventaire.json', JSON.stringify(sortie, null, 2))
console.log(`\nDétail écrit dans artifacts/verification/env/inventaire.json`)

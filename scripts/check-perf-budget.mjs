#!/usr/bin/env node
/**
 * check-perf-budget.mjs — budget de performance du bundle client (CI).
 *
 * Empêche une régression silencieuse du poids du JavaScript envoyé au
 * navigateur. Next.js émet le JS client dans `.next/static/**.js` après un
 * `next build`. Ce garde-fou mesure les OCTETS BRUTS sur disque (déterministes,
 * indépendants de la version de zlib — contrairement au gzip) et échoue si :
 *   - le total du JS client dépasse `totalClientJsBytes`, ou
 *   - le plus gros chunk client dépasse `largestChunkBytes`.
 *
 * Les budgets et la mesure de référence sont dans `perf-budget.json`.
 *
 * Fail-closed : si `.next/static` est absent, le contrôle ÉCHOUE (il faut
 * lancer `next build` d'abord) — on ne « passe » jamais un budget non mesuré.
 *
 * Usage : node scripts/check-perf-budget.mjs   (après `npm run build`)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const STATIC_DIR = join(ROOT, '.next', 'static')
const CHUNKS_DIR = join(STATIC_DIR, 'chunks')
const BUDGET_FILE = join(ROOT, 'perf-budget.json')

const KB = (n) => `${(n / 1024).toFixed(1)} KiB`
const MB = (n) => `${(n / 1048576).toFixed(2)} MiB`

if (!existsSync(BUDGET_FILE)) {
  console.error(`❌ Budget de perf absent : ${relative(ROOT, BUDGET_FILE)}`)
  process.exit(1)
}
const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
const MAX_TOTAL = budget.totalClientJsBytes
const MAX_CHUNK = budget.largestChunkBytes
if (!Number.isInteger(MAX_TOTAL) || !Number.isInteger(MAX_CHUNK)) {
  console.error('❌ perf-budget.json : totalClientJsBytes et largestChunkBytes doivent être des entiers (octets).')
  process.exit(1)
}

if (!existsSync(STATIC_DIR)) {
  console.error(`❌ ${relative(ROOT, STATIC_DIR)} absent — lancez « npm run build » avant ce contrôle (fail-closed).`)
  process.exit(1)
}

/** Liste récursivement tous les .js sous `dir`. */
function collectJs(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) collectJs(p, out)
    else if (entry.endsWith('.js')) out.push({ path: p, size: st.size })
  }
}

const allJs = []
collectJs(STATIC_DIR, allJs)
if (allJs.length === 0) {
  console.error(`❌ Aucun .js sous ${relative(ROOT, STATIC_DIR)} — build incomplet (fail-closed).`)
  process.exit(1)
}

const total = allJs.reduce((s, f) => s + f.size, 0)

// Le plus gros chunk CLIENT (dossier chunks/), pas les assets divers.
const chunks = existsSync(CHUNKS_DIR) ? allJs.filter((f) => f.path.startsWith(CHUNKS_DIR)) : allJs
const largest = chunks.reduce((max, f) => (f.size > max.size ? f : max), { size: 0, path: '' })

const violations = []
if (total > MAX_TOTAL) violations.push(`Total JS client ${MB(total)} (${total} octets) > budget ${MB(MAX_TOTAL)} (${MAX_TOTAL} octets), dépassement ${total - MAX_TOTAL} octets`)
if (largest.size > MAX_CHUNK) {
  violations.push(`Plus gros chunk ${KB(largest.size)} (${relative(ROOT, largest.path)}) > budget ${KB(MAX_CHUNK)}`)
}

console.log('Budget de performance — mesure du bundle client :')
console.log(`  Total JS client : ${MB(total)} (budget ${MB(MAX_TOTAL)})`)
console.log(`  Plus gros chunk : ${KB(largest.size)} — ${relative(ROOT, largest.path)} (budget ${KB(MAX_CHUNK)})`)
console.log(`  Fichiers .js scannés : ${allJs.length}`)

if (violations.length) {
  console.error('\n❌ Budget de performance dépassé :')
  for (const v of violations) console.error(`   • ${v}`)
  console.error('\n   → Réduisez le JS (imports dynamiques, code-splitting, dépendances plus légères)')
  console.error('     ou relevez explicitement le budget dans perf-budget.json (décision assumée).')
  process.exit(1)
}
console.log('\n✅ Budget de performance respecté.')

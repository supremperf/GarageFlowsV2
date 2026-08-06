#!/usr/bin/env node
/**
 * check-docs-consistency.mjs — garde-fou de cohérence documentaire (CI).
 *
 * Empêche la réapparition d'affirmations de statut trop favorables dans un
 * document ACTIF (non historique). La seule source de vérité de l'état de
 * préparation est docs/PRODUCTION-READINESS.md (exclue de ce contrôle car elle
 * DISCUTE ces termes pour les encadrer/nier).
 *
 * Un document est « historique » s'il contient le marqueur `doc-status: historique`
 * (bandeau ajouté en tête) — il est alors ignoré.
 *
 * Échoue si l'une des affirmations interdites apparaît dans un document actif :
 *   « aucun bloqueur », « production ready », « 100 % prêt »,
 *   « tous les tests passent », « aucune action nécessaire/requise ».
 *
 * Usage : node scripts/check-docs-consistency.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SOURCE_OF_TRUTH = 'docs/PRODUCTION-READINESS.md'

/** Normalise : minuscules + suppression des accents (comparaison robuste). */
function norm(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Motifs interdits (déjà normalisés, sans accents). Chaque entrée = {re, label}.
const FORBIDDEN = [
  { re: /aucun(e)?\s+bloqu(eur|ant)/, label: '« aucun bloqueur/bloquant »' },
  { re: /zero\s+bloqu(eur|ant)/, label: '« zéro bloqueur »' },
  { re: /production[\s-]?ready/, label: '« production ready »' },
  { re: /100\s*%\s*(pret|prete|ready|prod)/, label: '« 100 % prêt »' },
  { re: /tous\s+les\s+tests\s+passent/, label: '« tous les tests passent »' },
  { re: /aucune\s+action\s+(necessaire|requise)/, label: '« aucune action nécessaire/requise »' },
]

function collectMarkdown(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) collectMarkdown(p, out)
    else if (entry.toLowerCase().endsWith('.md')) out.push(p)
  }
}

const files = []
collectMarkdown(ROOT, files)

if (!existsSync(join(ROOT, SOURCE_OF_TRUTH))) {
  console.error(`❌ Source de vérité absente : ${SOURCE_OF_TRUTH}`)
  process.exit(1)
}

const violations = []
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  if (rel === SOURCE_OF_TRUTH) continue // la SoT encadre/nie ces termes
  const raw = readFileSync(file, 'utf8')
  if (norm(raw).includes('doc-status: historique')) continue // annexe historique
  const lines = raw.split('\n')
  lines.forEach((line, i) => {
    // Ignore les lignes de citation/négation explicites (« ne jamais … »).
    const n = norm(line)
    if (n.includes('ne jamais') || n.includes('ne pas annoncer') || n.includes('interdit')) return
    for (const f of FORBIDDEN) {
      if (f.re.test(n)) violations.push({ file: rel, line: i + 1, label: f.label, text: line.trim().slice(0, 120) })
    }
  })
}

if (violations.length) {
  console.error(`\n❌ Cohérence docs : ${violations.length} affirmation(s) de statut interdite(s) dans un document actif :`)
  for (const v of violations) console.error(`   ${v.file}:${v.line}  ${v.label}\n      ${v.text}`)
  console.error(`\n   → Corrigez le document, ou marquez-le HISTORIQUE (bandeau « doc-status: historique »),`)
  console.error(`     ou déplacez l'affirmation encadrée dans ${SOURCE_OF_TRUTH}.\n`)
  process.exit(1)
}
console.log(`✅ Cohérence docs : aucune affirmation de statut contradictoire dans les documents actifs (${files.length} .md scannés).`)

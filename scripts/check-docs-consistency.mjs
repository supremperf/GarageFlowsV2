#!/usr/bin/env node
/**
 * check-docs-consistency.mjs — garde-fou de cohérence documentaire (CI).
 *
 * Fin wrapper CLI autour de `scripts/lib/docs-consistency.mjs` (cœur testable).
 * Vérifie sur le dépôt : source canonique unique, aucune revendication
 * canonique forte hors baseline, aucun compte de tests courant divergent,
 * aucune affirmation de statut trop favorable. Voir le module pour le détail.
 *
 * Usage : node scripts/check-docs-consistency.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDocsConsistency, CANONICAL_PATH } from './lib/docs-consistency.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

if (!existsSync(join(ROOT, CANONICAL_PATH))) {
  console.error(`❌ Baseline canonique absente : ${CANONICAL_PATH}`)
  process.exit(1)
}

// Baseline machine (comptes de tests) — pour le contrôle de compte courant.
let baseline = null
const baselineFile = join(ROOT, 'artifacts', 'verification', 'baseline.json')
if (existsSync(baselineFile)) {
  try { baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) } catch { /* ignore */ }
}

const { ok, violations, scanned } = checkDocsConsistency(ROOT, { baseline })

if (!ok) {
  console.error(`\n❌ Cohérence docs : ${violations.length} incohérence(s) dans les documents actifs :`)
  for (const v of violations) {
    const loc = v.line ? `${v.file}:${v.line}` : v.file
    console.error(`   [${v.kind}] ${loc}  ${v.label}${v.text ? `\n      ${v.text}` : ''}`)
  }
  console.error(`\n   → Corrigez le document, marquez-le HISTORIQUE (« doc-status: historique »),`)
  console.error(`     ou pointez vers la baseline canonique ${CANONICAL_PATH}.\n`)
  process.exit(1)
}
console.log(`✅ Cohérence docs : source canonique unique, comptes & statuts cohérents (${scanned} .md scannés).`)

#!/usr/bin/env node
/**
 * Scanner de formulations INTERDITES (facturation électronique).
 *
 * Échoue (exit 1) si une communication du dépôt affirme une conformité non
 * prouvée (« Certifié conforme », « PDP intégré », etc.). Objectif : empêcher
 * structurellement toute sur-affirmation dans les docs et l'UI.
 *
 * Les patterns sont alignés sur src/lib/einvoicing/compliance.ts (vérifié par
 * un test). Une allowlist couvre les fichiers qui MENTIONNENT ces phrases pour
 * précisément les interdire (guide, scanner, audit, tests).
 *
 * Usage : node scripts/check-compliance-language.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const PATTERNS = [
  { id: 'certifie_conforme', re: /certifi[ée]e?s?\s+conforme/i },
  { id: 'pdp_integree', re: /pdp\s+int[ée]gr[ée]e?/i },
  { id: 'plateforme_agreee_integree', re: /plateforme\s+agr[ée]{2}e?\s+int[ée]gr[ée]e?/i },
  { id: 'certified_compliant', re: /certified\s+compliant/i },
  { id: 'homologue_facturation', re: /homologu[ée]e?\s+(pour\s+)?(la\s+)?facturation\s+[ée]lectronique/i },
]

// Fichiers autorisés à contenir ces phrases (ils les DÉFINISSENT ou les INTERDISENT).
const ALLOW = new Set([
  'src/lib/einvoicing/compliance.ts',
  'scripts/check-compliance-language.js',
  'docs/FACTURATION_ELECTRONIQUE_COMMERCIAL_GUIDELINES.md',
  'docs/COMMERCIAL_READINESS_AUDIT.md',
].map(p => path.normalize(p)))

// Dossiers scannés et exclusions.
const SCAN_DIRS = ['docs', 'src', 'electron']
const SCAN_ROOT_FILES = ['README.md']
const EXCLUDE_DIR = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'coverage'])
const EXCLUDE_PATH_FRAGMENT = ['src/generated', '__tests__', '.test.', '.spec.']
const EXT = new Set(['.md', '.ts', '.tsx', '.js', '.jsx', '.html', '.json'])

function isAllowed(rel) {
  if (ALLOW.has(path.normalize(rel))) return true
  return EXCLUDE_PATH_FRAGMENT.some(f => rel.includes(f))
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR.has(entry.name)) continue
      yield* walk(path.join(dir, entry.name))
    } else {
      yield path.join(dir, entry.name)
    }
  }
}

function scanFile(abs) {
  const rel = path.relative(ROOT, abs)
  if (isAllowed(rel)) return []
  if (!EXT.has(path.extname(abs))) return []
  let text
  try { text = fs.readFileSync(abs, 'utf8') } catch { return [] }
  const hits = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const { id, re } of PATTERNS) {
      const m = re.exec(lines[i])
      if (m) hits.push({ rel, line: i + 1, id, match: m[0].trim() })
    }
  }
  return hits
}

function main() {
  const files = []
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d)
    if (fs.existsSync(abs)) for (const f of walk(abs)) files.push(f)
  }
  for (const f of SCAN_ROOT_FILES) {
    const abs = path.join(ROOT, f)
    if (fs.existsSync(abs)) files.push(abs)
  }

  const allHits = files.flatMap(scanFile)
  if (allHits.length === 0) {
    console.log('✔ Aucune formulation de conformité interdite détectée.')
    process.exit(0)
  }
  console.error('✖ Formulations de conformité INTERDITES détectées :')
  for (const h of allHits) {
    console.error(`  ${h.rel}:${h.line}  [${h.id}]  « ${h.match} »`)
  }
  console.error('\nVoir docs/FACTURATION_ELECTRONIQUE_COMMERCIAL_GUIDELINES.md — ne jamais affirmer une conformité non prouvée.')
  process.exit(1)
}

main()

#!/usr/bin/env node
/**
 * check-money-calculations.mjs — garde-fou des CALCULS financiers (CI).
 *
 * Détecte les calculs monétaires DIRECTS interdits hors de la couche financière
 * centrale (src/lib/money.ts) :
 *   1. multiplication prix × quantité en flottant natif (unitPrice * quantity…) ;
 *   2. arrondi artisanal Math.round(x * 100) / 100 sur une expression monétaire ;
 *   3. parseFloat(...) sur une valeur monétaire ;
 *   4. calcul TTC direct « * (1 + taxRate / 100) ».
 *
 * Périmètre : src/ et electron/ (runtime). Les EXCEPTIONS sont ciblées
 * {fichier, sous-chaîne, raison} — jamais un dossier entier. Toute nouvelle
 * occurrence non documentée ÉCHOUE la CI.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCAN_DIRS = ['src', 'electron']
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx'])

// Fichiers formant la COUCHE FINANCIÈRE elle-même (seuls habilités à l'arithmétique).
const MONEY_LAYER = new Set(['src/lib/money.ts'])

const MONEY_TOKEN = /unitPrice|unitCost|totalHT|totalTTC|amount|price|cost|deposit|margin|revenue|balance|caHT|caTTC|tva|HT\b|TTC\b/i

const RULES = [
  {
    name: 'prix × quantité flottant',
    test: (l) => /\b(\w+\.)?(unitPrice|unitCost|price)\s*\*\s*(\w+\.)?(quantity|qty)\b/.test(l) || /\b(\w+\.)?(quantity|qty)\s*\*\s*(\w+\.)?(unitPrice|unitCost|price)\b/.test(l),
  },
  {
    name: 'arrondi artisanal Math.round(x*100)/100 monétaire',
    test: (l) => /Math\.round\([^)]*\*\s*100\s*\)\s*\/\s*100/.test(l) && MONEY_TOKEN.test(l),
  },
  {
    name: 'parseFloat monétaire',
    test: (l) => /parseFloat\(/.test(l) && MONEY_TOKEN.test(l),
  },
  {
    name: 'calcul TTC direct (1 + taxRate/100)',
    test: (l) => /\*\s*\(\s*1\s*\+\s*[^)]*taxRate[^)]*\/\s*100\s*\)/.test(l),
  },
]

// Exceptions ciblées {file, needle, reason} — chacune est affichée.
const EXCEPTIONS = [
  // (aucune à ce jour — la couche centrale src/lib/money.ts est déjà hors périmètre)
]

function stripComments(line) {
  const t = line.trimStart()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  let out = line.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const idx = out.indexOf('//')
  if (idx >= 0 && !/https?:$/.test(out.slice(0, idx + 1))) out = out.slice(0, idx)
  return out
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'generated') continue
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

const violations = []
const usedExceptions = []
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  if (MONEY_LAYER.has(rel)) continue // la couche centrale implémente les règles
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((rawLine, i) => {
    const line = stripComments(rawLine)
    if (!line) return
    for (const rule of RULES) {
      if (!rule.test(line)) continue
      const exc = EXCEPTIONS.find((e) => rel === e.file && rawLine.includes(e.needle))
      if (exc) { usedExceptions.push(`${rel}:${i + 1} — ${exc.reason}`); continue }
      violations.push({ file: rel, line: i + 1, rule: rule.name, text: rawLine.trim().slice(0, 110) })
    }
  })
}

if (usedExceptions.length) {
  console.log('Exceptions de calcul ACTIVES (ciblées, documentées) :')
  for (const e of usedExceptions) console.log(`   • ${e}`)
}
if (violations.length) {
  console.error(`\n❌ ${violations.length} calcul(s) financier(s) direct(s) interdit(s) :`)
  for (const v of violations) console.error(`   ${v.file}:${v.line}  [${v.rule}]\n      ${v.text}`)
  console.error('\n   → Passez par src/lib/money.ts (lineCents, computeTotals, toCents/fromCents, parseAmountToScaled).\n')
  process.exit(1)
}
console.log(`✅ Calculs financiers : aucun calcul direct interdit hors couche centrale (${files.length} fichiers).`)

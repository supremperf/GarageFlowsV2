#!/usr/bin/env node
/**
 * check-money-fields.mjs — garde-fou monétaire STRICT (CI).
 *
 * RÈGLE ABSOLUE : **ZÉRO champ monétaire `Float`** dans les schémas Prisma.
 * Il n'existe PLUS de liste « suivie » de champs monétaires Float tolérés : la
 * migration est TERMINÉE (entiers exacts — centimes `*Cents` et dix-millièmes
 * `*TenThousandths`). Toute réapparition d'un Float monétaire ÉCHOUE la CI.
 *
 * Un champ `Float` n'est accepté QUE s'il est explicitement classé NON MONÉTAIRE
 * dans NON_MONETARY (modèle + champ + nature + justification). Tout Float non
 * classé échoue aussi (aucun montant ne peut se glisser sans classification).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCHEMAS = ['prisma/schema.prisma', 'prisma/server/schema.prisma']

// Float NON monétaires autorisés — classification EXPLICITE et justifiée.
// (Nature : taux en POURCENTAGE, pas des montants. Les valeurs métier réelles
// — 0, 5,5, 10, 20 — sont exactement représentables en binaire ; la TVA est
// calculée par UNE multiplication puis UN arrondi en centimes dans lib/money.ts.)
const NON_MONETARY = {
  'Garage.taxRate': 'taux de TVA (%) — non monétaire, valeurs exactes en binaire',
  'Quote.taxRate': 'taux de TVA (%) — non monétaire',
  'Invoice.taxRate': 'taux de TVA (%) — non monétaire',
  'WorkOrder.taxRate': 'taux de TVA (%) — non monétaire',
}

// Détection de champs MONÉTAIRES par sémantique de nom — un nouveau champ Float
// dont le nom évoque l'argent est refusé même s'il était « classé » par erreur.
const MONETARY_NAME = /price|cost|amount|total|deposit|rate(?!Limit)|margin|paid|balance|discount|refund|cents|euro/i

/** Extrait { 'Model.field': true } des champs Float d'un schéma Prisma. */
function floatFields(schemaText) {
  const out = {}
  let model = null
  for (const raw of schemaText.split('\n')) {
    const line = raw.trim()
    const mm = line.match(/^model\s+(\w+)\s*\{/)
    if (mm) { model = mm[1]; continue }
    if (line === '}') { model = null; continue }
    if (!model) continue
    const fm = line.match(/^(\w+)\s+Float(\?|\s|\b)/)
    if (fm) out[`${model}.${fm[1]}`] = true
  }
  return out
}

const allFloat = {}
for (const s of SCHEMAS) {
  const abs = join(ROOT, s)
  if (!existsSync(abs)) continue
  Object.assign(allFloat, floatFields(readFileSync(abs, 'utf8')))
}

const errors = []
const allowed = []
let monetaryFloatCount = 0
for (const key of Object.keys(allFloat).sort()) {
  const field = key.split('.')[1]
  const classified = NON_MONETARY[key]
  const looksMonetary = MONETARY_NAME.test(field) && !/^taxRate$/.test(field)
  if (looksMonetary) {
    monetaryFloatCount++
    errors.push(`${key} : champ Float au nom MONÉTAIRE — INTERDIT (utiliser Int centimes/dix-millièmes)`)
  } else if (!classified) {
    errors.push(`${key} : champ Float NON CLASSÉ — ajoutez-le à NON_MONETARY (avec justification) ou migrez-le en entier exact`)
  } else {
    allowed.push(`${key} — ${classified}`)
  }
}

console.log(`Schémas analysés : ${SCHEMAS.join(', ')}`)
console.log(`Champs Float NON monétaires classés (autorisés) : ${allowed.length}`)
for (const a of allowed) console.log(`   • ${a}`)

if (errors.length) {
  console.error(`\n❌ ${errors.length} violation(s) :`)
  for (const e of errors) console.error(`   • ${e}`)
  console.error('\nRÈGLE : 0 champ monétaire Float. La migration est terminée — aucun retour en arrière.\n')
  process.exit(1)
}
console.log(`\n✅ ${monetaryFloatCount} champ monétaire Float (RÈGLE : zéro). Stockage monétaire 100 % en entiers exacts.`)

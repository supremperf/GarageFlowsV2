#!/usr/bin/env node
/**
 * check-money-fields.mjs — garde-fou « pas de Float monétaire non classé » (CI).
 *
 * Analyse les DEUX schémas Prisma, repère chaque champ `Float`, et le confronte à
 * une CLASSIFICATION EXPLICITE (par `Model.champ`). Objectif :
 *   - ÉCHOUER si un champ Float monétaire N'EST PAS classé (nouveau Float d'argent
 *     non maîtrisé → régression) ;
 *   - autoriser les Float NON monétaires (taux, quantité) après classification ;
 *   - AFFICHER le SUIVI des champs monétaires encore en Float (miroir dérivé /
 *     migration stagée) — transparence, pas de dissimulation.
 *
 * Ce script ne « masque » rien : chaque Float monétaire restant est listé
 * nommément avec sa raison et un renvoi à docs/MIGRATION-MONEY.md.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCHEMAS = ['prisma/schema.prisma', 'prisma/server/schema.prisma']

// Float NON monétaires (autorisés définitivement, classés).
const NON_MONETARY = {
  'Garage.taxRate': 'taux de TVA (%) — non monétaire',
  'Quote.taxRate': 'taux de TVA (%)',
  'Invoice.taxRate': 'taux de TVA (%)',
  'WorkOrder.taxRate': 'taux de TVA (%)',
  'QuoteLine.quantity': 'quantité (fractionnable) — non monétaire',
  'InvoiceLine.quantity': 'quantité (fractionnable) — non monétaire',
}

// Float MONÉTAIRES encore présents — SUIVIS (à migrer), jamais « masqués ».
const MONETARY_TRACKED = {
  // Totaux : colonnes *Cents = source de vérité ; Float = MIROIR dérivé. Retrait
  // gaté sur backfill des données réelles (voir docs/MIGRATION-MONEY.md §5-6).
  'WorkOrder.totalHT': 'miroir dérivé (source: totalHtCents) — retrait gaté sur backfill prod',
  'WorkOrder.totalTTC': 'miroir dérivé (source: totalTtcCents) — retrait gaté sur backfill prod',
  'PurchaseOrder.totalHT': 'miroir dérivé (source: totalHtCents) — retrait gaté sur backfill prod',
  'LoanerReservation.depositAmount': 'miroir dérivé (source: depositAmountCents) — retrait gaté sur backfill prod',
  // Prix/coûts unitaires : migration en sous-unités entières STAGÉE (SQLite ∌
  // @db.Decimal ; risque signatures) — le CALCUL est déjà exact/4-décimales via
  // lib/money.ts (lineCents). Voir docs/MIGRATION-MONEY.md §7.
  'Garage.hourlyRate': 'prix unitaire (€/h) — migration sous-unités stagée',
  'Part.unitCost': 'coût unitaire — migration sous-unités stagée',
  'Part.unitPrice': 'prix unitaire — migration sous-unités stagée',
  'JobPart.unitPrice': 'prix unitaire (snapshot) — migration sous-unités stagée',
  'JobPart.unitCost': 'coût unitaire (snapshot) — migration sous-unités stagée',
  'QuoteLine.unitPrice': 'prix unitaire — migration sous-unités stagée',
  'QuoteLine.unitCost': 'coût unitaire — migration sous-unités stagée',
  'InvoiceLine.unitPrice': 'prix unitaire (légal) — migration sous-unités stagée',
  'InvoiceLine.unitCost': 'coût unitaire — migration sous-unités stagée',
  'LaborOperation.unitPrice': 'prix unitaire (forfait MO) — migration sous-unités stagée',
  'LoanerReservation.dailyRate': 'tarif unitaire (€/jour) — migration sous-unités stagée',
}

/** Extrait { 'Model.field': 'Float' } d'un schéma Prisma. */
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

const unclassified = []
const tracked = []
const nonMonetary = []
for (const key of Object.keys(allFloat).sort()) {
  if (NON_MONETARY[key]) nonMonetary.push(key)
  else if (MONETARY_TRACKED[key]) tracked.push(key)
  else unclassified.push(key)
}

console.log(`Champs Float NON monétaires (autorisés) : ${nonMonetary.length}`)
for (const k of nonMonetary) console.log(`   • ${k} — ${NON_MONETARY[k]}`)
console.log(`\nChamps Float MONÉTAIRES encore présents (SUIVI — à migrer, voir docs/MIGRATION-MONEY.md) : ${tracked.length}`)
for (const k of tracked) console.log(`   • ${k} — ${MONETARY_TRACKED[k]}`)

if (unclassified.length) {
  console.error(`\n❌ ${unclassified.length} champ(s) Float NON CLASSÉ(s) — un montant monétaire en Float non maîtrisé est INTERDIT :`)
  for (const k of unclassified) console.error(`   • ${k}`)
  console.error(`\n   → Classez-le dans NON_MONETARY (taux/quantité) ou MONETARY_TRACKED (avec plan de migration) dans scripts/check-money-fields.mjs.`)
  process.exit(1)
}
console.log(`\n✅ Aucun Float monétaire non classé. ${tracked.length} champ(s) monétaire(s) suivis pour migration ; le CALCUL est déjà exact (centimes, lib/money.ts).`)

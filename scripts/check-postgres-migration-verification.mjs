#!/usr/bin/env node
/**
 * check-postgres-migration-verification.mjs — garde-fou CI des migrations
 * PostgreSQL monétaires : AUCUNE colonne supprimée sans preuve.
 *
 * Contrôles (échec = exit 1) :
 *   1. `money_drop_floats` : chaque `DROP COLUMN "X"` possède sa ligne de
 *      vérification (table, ancienne colonne, colonne cible) dans le bloc
 *      `DO $gfdrop$` — bijection stricte (pas de drop sans preuve, pas de
 *      preuve morte sans drop) ;
 *   2. le bloc de vérification est placé AVANT le premier DROP (ordre du
 *      fichier) et contient RAISE EXCEPTION (bloquant, pas un simple NOTICE) ;
 *   3. `money_scaled_units` : chaque colonne cible est réellement BACKFILLÉE
 *      (UPDATE … SET "cible" = …) et chaque paire (ancienne, cible) est
 *      re-vérifiée dans le bloc `DO $gfmoney$` avec RAISE EXCEPTION mentionnant
 *      la table ;
 *   4. cohérence : la liste canonique des 17 colonnes migrées correspond
 *      exactement à ce que les fichiers font (toute dérive casse la CI).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIG = path.join(ROOT, 'prisma', 'server', 'migrations')
const scaledPath = path.join(MIG, '20260807000000_money_scaled_units', 'migration.sql')
const dropPath = path.join(MIG, '20260807100000_money_drop_floats', 'migration.sql')

// Liste CANONIQUE des colonnes Float supprimées → colonne exacte cible.
// Toute évolution des migrations doit être reflétée ici (et inversement).
const CANONICAL = [
  ['Garage', 'hourlyRate', 'hourlyRateTenThousandths'],
  ['Part', 'unitCost', 'unitCostTenThousandths'],
  ['Part', 'unitPrice', 'unitPriceTenThousandths'],
  ['JobPart', 'unitPrice', 'unitPriceTenThousandths'],
  ['JobPart', 'unitCost', 'unitCostTenThousandths'],
  ['QuoteLine', 'quantity', 'quantityTenThousandths'],
  ['QuoteLine', 'unitPrice', 'unitPriceTenThousandths'],
  ['QuoteLine', 'unitCost', 'unitCostTenThousandths'],
  ['InvoiceLine', 'quantity', 'quantityTenThousandths'],
  ['InvoiceLine', 'unitPrice', 'unitPriceTenThousandths'],
  ['InvoiceLine', 'unitCost', 'unitCostTenThousandths'],
  ['LaborOperation', 'unitPrice', 'unitPriceTenThousandths'],
  ['LoanerReservation', 'dailyRate', 'dailyRateTenThousandths'],
  ['LoanerReservation', 'depositAmount', 'depositAmountCents'],
  ['WorkOrder', 'totalHT', 'totalHtCents'],
  ['WorkOrder', 'totalTTC', 'totalTtcCents'],
  ['PurchaseOrder', 'totalHT', 'totalHtCents'],
]

const errors = []
const dropSql = readFileSync(dropPath, 'utf8')
const scaledSql = readFileSync(scaledPath, 'utf8')

// ── 1. money_drop_floats : bijection DROP ↔ ligne de vérification ─────────────
const dropBlockMatch = dropSql.match(/DO \$gfdrop\$([\s\S]*?)\$gfdrop\$;/)
if (!dropBlockMatch) {
  errors.push('money_drop_floats : bloc DO $gfdrop$ de re-vérification INTROUVABLE')
} else {
  const block = dropBlockMatch[1]
  if (!/RAISE EXCEPTION/.test(block)) {
    errors.push('money_drop_floats : le bloc de vérification ne contient aucun RAISE EXCEPTION (non bloquant)')
  }

  const drops = [...dropSql.matchAll(/ALTER TABLE\s+"(\w+)"\s+DROP COLUMN IF EXISTS\s+"(\w+)"/g)].map(
    (m) => [m[1], m[2]],
  )
  if (drops.length === 0) errors.push('money_drop_floats : aucun DROP COLUMN détecté (fichier inattendu)')

  // Le bloc de vérification doit précéder le PREMIER DROP.
  const firstDrop = dropSql.search(/ALTER TABLE\s+"\w+"\s+DROP COLUMN/)
  if (firstDrop !== -1 && dropSql.indexOf('DO $gfdrop$') > firstDrop) {
    errors.push('money_drop_floats : le bloc de vérification apparaît APRÈS un DROP (ordre invalide)')
  }

  // Lignes de spécification (table, ancienne colonne, colonne cible) du bloc.
  const specs = [
    ...block.matchAll(/\('(\w+)'(?:::text)?,\s*'(\w+)'(?:::text)?,\s*'(\w+)'(?:::text)?,\s*(\d+)(?:::numeric)?,\s*(true|false)\)/g),
  ].map((m) => ({ tbl: m[1], oldCol: m[2], newCol: m[3], scale: Number(m[4]) }))

  for (const [tbl, col] of drops) {
    if (!specs.some((s) => s.tbl === tbl && s.oldCol === col)) {
      errors.push(`money_drop_floats : DROP de "${tbl}"."${col}" SANS ligne de vérification correspondante`)
    }
    if (!CANONICAL.some(([t, o]) => t === tbl && o === col)) {
      errors.push(`money_drop_floats : DROP de "${tbl}"."${col}" absent de la liste canonique (mettre à jour guard + docs)`)
    }
  }
  for (const s of specs) {
    if (!drops.some(([t, c]) => t === s.tbl && c === s.oldCol)) {
      errors.push(`money_drop_floats : vérification de "${s.tbl}"."${s.oldCol}" sans DROP associé (preuve morte)`)
    }
  }
  for (const [tbl, oldCol, newCol] of CANONICAL) {
    const spec = specs.find((s) => s.tbl === tbl && s.oldCol === oldCol)
    if (!spec) {
      errors.push(`money_drop_floats : colonne canonique "${tbl}"."${oldCol}" sans ligne de vérification`)
    } else if (spec.newCol !== newCol) {
      errors.push(`money_drop_floats : "${tbl}"."${oldCol}" vérifiée contre "${spec.newCol}" (attendu "${newCol}")`)
    }
  }
}

// ── 2. money_scaled_units : backfill + vérification par colonne ───────────────
const scaledBlockMatch = scaledSql.match(/DO \$gfmoney\$([\s\S]*?)\$gfmoney\$;/)
if (!scaledBlockMatch) {
  errors.push('money_scaled_units : bloc DO $gfmoney$ de vérification INTROUVABLE')
} else {
  const block = scaledBlockMatch[1]
  // Backfill réel : UPDATE "Table" … SET/,"cible" = …
  const updates = new Map()
  for (const m of scaledSql.matchAll(/UPDATE\s+"(\w+)"\s+SET([\s\S]*?);/g)) {
    const cols = new Set([...m[2].matchAll(/"(\w+)"\s*=/g)].map((x) => x[1]))
    updates.set(m[1], new Set([...(updates.get(m[1]) ?? []), ...cols]))
  }
  const raiseLines = (block.match(/RAISE EXCEPTION[^;]*;/g) ?? []).join('\n')

  for (const [tbl, oldCol, newCol] of CANONICAL) {
    if (!updates.get(tbl)?.has(newCol)) {
      errors.push(`money_scaled_units : "${tbl}"."${newCol}" jamais backfillée (UPDATE manquant)`)
    }
    if (!block.includes(`"${oldCol}"`) || !block.includes(`"${newCol}"`)) {
      errors.push(`money_scaled_units : vérification manquante pour "${tbl}"."${oldCol}" → "${newCol}"`)
    }
    if (!raiseLines.includes(tbl)) {
      errors.push(`money_scaled_units : aucun RAISE EXCEPTION ne mentionne la table "${tbl}"`)
    }
  }
}

if (errors.length) {
  console.error(`\n❌ Migrations PostgreSQL : ${errors.length} problème(s) de vérification :`)
  for (const e of errors) console.error(`   • ${e}`)
  process.exit(1)
}
console.log(
  `✅ Migrations PostgreSQL : ${CANONICAL.length} colonnes supprimées, chacune avec backfill + vérification bloquante (scaled_units) et re-vérification pré-DROP (drop_floats), bloc de contrôle avant tout DROP.`,
)

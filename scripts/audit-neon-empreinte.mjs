/**
 * EMPREINTE LECTURE SEULE de la base Neon — point de comparaison avant/après.
 *
 * Se lance AVANT toute écriture, puis À NOUVEAU après. Les deux sorties se
 * comparent littéralement : toute divergence non expliquée par une migration
 * est une perte. Couvre en particulier les 17 colonnes monétaires entières que
 * `20260807100000_money_drop_floats` laisse derrière lui après avoir supprimé
 * leurs sources Float — c'est la preuve qu'aucun montant n'a bougé.
 *
 * Aucune écriture. Uniquement des SELECT.
 *
 * Usage : node scripts/audit-neon-empreinte.mjs > artifacts/…/empreinte-<t>.txt
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/server-client/index.js'

function lireEnv(nom) {
  const contenu = fs.readFileSync(path.resolve('.env'), 'utf8')
  let valeur = null
  for (const ligne of contenu.split(/\r?\n/)) {
    if (!ligne.startsWith(`${nom}=`)) continue
    valeur = ligne.slice(nom.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return valeur
}

const url = lireEnv('DIRECT_URL') ?? lireEnv('DATABASE_URL')
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('DIRECT_URL PostgreSQL introuvable dans .env')
  process.exit(2)
}
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** Colonnes monétaires entières survivantes (cibles de money_drop_floats). */
const MONNAIE = [
  ['Garage', 'hourlyRateTenThousandths'],
  ['Part', 'unitCostTenThousandths'], ['Part', 'unitPriceTenThousandths'],
  ['JobPart', 'unitPriceTenThousandths'], ['JobPart', 'unitCostTenThousandths'],
  ['QuoteLine', 'quantityTenThousandths'], ['QuoteLine', 'unitPriceTenThousandths'],
  ['QuoteLine', 'unitCostTenThousandths'],
  ['InvoiceLine', 'quantityTenThousandths'], ['InvoiceLine', 'unitPriceTenThousandths'],
  ['InvoiceLine', 'unitCostTenThousandths'],
  ['LaborOperation', 'unitPriceTenThousandths'],
  ['LoanerReservation', 'dailyRateTenThousandths'], ['LoanerReservation', 'depositAmountCents'],
  ['WorkOrder', 'totalHtCents'], ['WorkOrder', 'totalTtcCents'],
  ['PurchaseOrder', 'totalHtCents'],
]

const TABLES = [
  'Garage', 'User', 'LicenseKey', 'Job', 'JobPart', 'Invoice', 'InvoiceLine',
  'Quote', 'QuoteLine', 'Part', 'Mechanic', 'Client', 'Vehicle', 'WorkOrder',
  'PurchaseOrder', 'LaborOperation', 'LoanerReservation', 'StockMovement',
]

try {
  const hist = await prisma.$queryRawUnsafe(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
       FROM _prisma_migrations ORDER BY started_at ASC`)
  console.log(`╔══ _prisma_migrations : ${hist.length} enregistrement(s)`)
  for (const m of hist) {
    const etat = m.rolled_back_at ? 'ANNULÉE  ' : (m.finished_at ? 'terminée ' : 'INACHEVÉE')
    console.log(`║  [${etat}] steps=${String(m.applied_steps_count).padStart(2)}  ${m.migration_name}`)
  }

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
  const tset = new Set(tbl.map((t) => t.table_name))
  console.log(`\n╔══ VOLUMÉTRIE (${tset.size} tables au total dans public)`)
  for (const t of TABLES) {
    if (!tset.has(t)) { console.log(`║  (absente)  ${t}`); continue }
    const [r] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    console.log(`║  ${String(r.n).padStart(7)}  ${t}`)
  }

  console.log('\n╔══ SOMMES MONÉTAIRES (colonnes entières — invariantes attendues)')
  for (const [t, c] of MONNAIE) {
    if (!tset.has(t)) { console.log(`║  (table absente)  ${t}.${c}`); continue }
    const [r] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("${c}")::text,'0') AS somme, COUNT("${c}")::int AS renseignes,
              COUNT(*)::int AS lignes FROM "${t}"`).catch(() => [null])
    if (!r) { console.log(`║  (colonne absente)  ${t}.${c}`); continue }
    console.log(`║  somme=${String(r.somme).padStart(14)}  renseignés=${String(r.renseignes).padStart(6)}/${String(r.lignes).padEnd(6)}  ${t}.${c}`)
  }

  console.log('\n╔══ DÉFINITION EXACTE des colonnes sous surveillance')
  const surveil = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND (
        (table_name='Job' AND column_name='timerAccumulatedSec')
        OR (table_name='WorkOrder' AND column_name IN ('totalHtCents','totalTtcCents'))
        OR (table_name='PurchaseOrder' AND column_name='totalHtCents'))
      ORDER BY table_name, column_name`)
  for (const c of surveil)
    console.log(`║  ${c.table_name}.${c.column_name} : ${c.data_type}, nullable=${c.is_nullable}, défaut=${c.column_default ?? 'aucun'}`)

  console.log('\n╔══ COLONNES FLOAT SOURCES encore présentes (supprimées par money_drop_floats)')
  const floats = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND (
        (table_name='Garage' AND column_name='hourlyRate')
        OR (table_name IN ('Part','JobPart','QuoteLine','InvoiceLine','LaborOperation') AND column_name IN ('unitCost','unitPrice','quantity'))
        OR (table_name='LoanerReservation' AND column_name IN ('dailyRate','depositAmount'))
        OR (table_name IN ('WorkOrder','PurchaseOrder') AND column_name IN ('totalHT','totalTTC')))
      ORDER BY table_name, column_name`)
  console.log(`║  ${floats.length} colonne(s) Float source encore en base`)
  for (const c of floats) console.log(`║    ${c.table_name}.${c.column_name} (${c.data_type})`)
} catch (e) {
  console.error('Empreinte impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 400))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

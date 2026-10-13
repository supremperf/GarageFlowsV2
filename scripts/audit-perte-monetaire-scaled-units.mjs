/**
 * AUDIT LECTURE SEULE — que DÉTRUIRAIT `20260807000000_money_scaled_units` ?
 *
 * Cette migration recalcule les colonnes monétaires entières depuis les anciennes
 * colonnes Float, SANS CONDITION :
 *     UPDATE "X" SET "yTenThousandths" = ROUND(("y"::numeric) * 10000)::int;
 * Elle suppose donc que le Float est la source de vérité pour CHAQUE ligne.
 *
 * Or le schéma serveur ne déclare plus ces Float : Prisma Client ne peut plus les
 * écrire. Toute ligne créée depuis porte le montant UNIQUEMENT dans la colonne
 * entière, le Float restant NULL ou à sa valeur par défaut. Sur ces lignes, le
 * recalcul remplace un montant réel par une valeur dérivée du vide — et le
 * contrôle intégré ne le voit pas, puisque le résultat est cohérent avec sa
 * source.
 *
 * On simule donc le recalcul et l'on chiffre l'écart, colonne par colonne.
 * Aucune écriture : uniquement des SELECT.
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
const prisma = new PrismaClient({ datasources: { db: { url: lireEnv('DIRECT_URL') } } })

/** Les 17 couples exactement tels que money_drop_floats les énumère. */
const COUPLES = [
  ['Garage', 'hourlyRate', 'hourlyRateTenThousandths', 10000],
  ['Part', 'unitCost', 'unitCostTenThousandths', 10000],
  ['Part', 'unitPrice', 'unitPriceTenThousandths', 10000],
  ['JobPart', 'unitPrice', 'unitPriceTenThousandths', 10000],
  ['JobPart', 'unitCost', 'unitCostTenThousandths', 10000],
  ['QuoteLine', 'quantity', 'quantityTenThousandths', 10000],
  ['QuoteLine', 'unitPrice', 'unitPriceTenThousandths', 10000],
  ['QuoteLine', 'unitCost', 'unitCostTenThousandths', 10000],
  ['InvoiceLine', 'quantity', 'quantityTenThousandths', 10000],
  ['InvoiceLine', 'unitPrice', 'unitPriceTenThousandths', 10000],
  ['InvoiceLine', 'unitCost', 'unitCostTenThousandths', 10000],
  ['LaborOperation', 'unitPrice', 'unitPriceTenThousandths', 10000],
  ['LoanerReservation', 'dailyRate', 'dailyRateTenThousandths', 10000],
  ['LoanerReservation', 'depositAmount', 'depositAmountCents', 100],
  ['WorkOrder', 'totalHT', 'totalHtCents', 100],
  ['WorkOrder', 'totalTTC', 'totalTtcCents', 100],
  ['PurchaseOrder', 'totalHT', 'totalHtCents', 100],
]

const fmt = (n) => (n === null || n === undefined ? 'NULL' : String(n))

try {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public'`)
  const info = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]))

  let totalLignesAPerte = 0
  const alertes = []

  console.log('╔══ SIMULATION du recalcul de money_scaled_units (aucune écriture)\n')
  for (const [tbl, oldc, newc, scale] of COUPLES) {
    if (!info.has(`${tbl}.${oldc}`) || !info.has(`${tbl}.${newc}`)) {
      console.log(`── ${tbl}.${oldc} → ${newc} : couple incomplet en base, ignoré`)
      continue
    }
    const [r] = await prisma.$queryRawUnsafe(`
      SELECT
        count(*)::int AS lignes,
        COALESCE(SUM("${newc}")::numeric, 0)::text AS somme_avant,
        COALESCE(SUM(CASE WHEN "${oldc}" IS NULL THEN NULL
                          ELSE ROUND(("${oldc}"::numeric) * ${scale})::bigint END)::numeric, 0)::text AS somme_apres,
        count(*) FILTER (WHERE "${oldc}" IS NULL AND "${newc}" IS NOT NULL)::int AS perte_null,
        count(*) FILTER (WHERE "${oldc}" IS NOT NULL AND "${newc}" IS NOT NULL
                           AND abs("${newc}" - ("${oldc}"::numeric) * ${scale}) > 0.5)::int AS ecrasement,
        count(*) FILTER (WHERE "${oldc}" IS NOT NULL AND "${newc}" IS NULL)::int AS backfill_normal
      FROM "${tbl}"`)

    const avant = BigInt(String(r.somme_avant).split('.')[0])
    const apres = BigInt(String(r.somme_apres).split('.')[0])
    const delta = apres - avant
    const risque = r.perte_null > 0 || r.ecrasement > 0

    if (risque) {
      totalLignesAPerte += r.perte_null + r.ecrasement
      alertes.push({ tbl, oldc, newc, scale, ...r, delta })
    }
    console.log(`── ${risque ? '!! RISQUE' : '   sûr   '} ${tbl}.${oldc} → ${newc}  (${r.lignes} lignes)`)
    console.log(`      somme entière AVANT=${fmt(avant)}  APRÈS recalcul=${fmt(apres)}  écart=${delta >= 0n ? '+' : ''}${delta}`)
    if (r.perte_null) console.log(`      ${r.perte_null} ligne(s) : Float NULL mais entier renseigné → l'entier serait EFFACÉ`)
    if (r.ecrasement) console.log(`      ${r.ecrasement} ligne(s) : Float et entier divergents → l'entier serait ÉCRASÉ`)
    if (r.backfill_normal) console.log(`      ${r.backfill_normal} ligne(s) : backfill légitime (Float renseigné, entier vide)`)
  }

  console.log(`\n══ VERDICT : ${totalLignesAPerte === 0
    ? 'aucune ligne ne perdrait de montant'
    : `${totalLignesAPerte} ligne(s) perdraient ou verraient écrasé un montant réel`}`)
  for (const a of alertes)
    console.log(`   ${a.tbl}.${a.newc} : écart ${a.delta >= 0n ? '+' : ''}${a.delta} (échelle ${a.scale})`)
} catch (e) {
  console.error('Audit impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 500))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

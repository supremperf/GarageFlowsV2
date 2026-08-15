/**
 * AUDIT LECTURE SEULE — pour CHAQUE ligne divergente, qui dit la vérité ?
 *
 * `money_scaled_units` recalcule l'entier depuis le Float sans condition. Selon
 * l'âge de la ligne, ce n'est pas le même geste :
 *
 *   A) Float renseigné, entier vide (0/NULL)  → BACKFILL LÉGITIME, c'est le but.
 *   B) Float vide (0/NULL), entier renseigné  → DESTRUCTION : le montant réel,
 *      écrit par le code actuel qui ne connaît plus le Float, serait remis à 0.
 *   C) les deux renseignés et différents      → CONFLIT : arbitrage nécessaire,
 *      aucune règle automatique n'est défendable.
 *
 * Seul B (et C) justifie une intervention. Aucune écriture ici.
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

try {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public'`)
  const nullable = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c.is_nullable]))

  let totB = 0, totC = 0
  console.log('╔══ CLASSEMENT des lignes divergentes\n')
  for (const [tbl, oldc, newc, scale] of COUPLES) {
    if (!nullable.has(`${tbl}.${oldc}`) || !nullable.has(`${tbl}.${newc}`)) continue
    const [r] = await prisma.$queryRawUnsafe(`
      SELECT
        count(*)::int AS lignes,
        count(*) FILTER (WHERE COALESCE("${oldc}",0) <> 0 AND COALESCE("${newc}",0) = 0)::int AS a_backfill,
        count(*) FILTER (WHERE COALESCE("${oldc}",0) = 0 AND COALESCE("${newc}",0) <> 0)::int AS b_destruction,
        count(*) FILTER (WHERE COALESCE("${oldc}",0) <> 0 AND COALESCE("${newc}",0) <> 0
                           AND abs("${newc}" - ("${oldc}"::numeric) * ${scale}) > 0.5)::int AS c_conflit,
        COALESCE(SUM(CASE WHEN COALESCE("${oldc}",0) = 0 AND COALESCE("${newc}",0) <> 0
                          THEN "${newc}" ELSE 0 END)::numeric, 0)::text AS montant_detruit
      FROM "${tbl}"`)
    totB += r.b_destruction; totC += r.c_conflit
    if (r.a_backfill + r.b_destruction + r.c_conflit === 0) continue
    console.log(`── ${tbl}.${oldc} ⇄ ${newc}   (${r.lignes} lignes ; Float nullable=${nullable.get(`${tbl}.${oldc}`)})`)
    if (r.a_backfill)    console.log(`      A  ${String(r.a_backfill).padStart(3)} backfill légitime  (Float→entier vide)`)
    if (r.b_destruction) console.log(`      B  ${String(r.b_destruction).padStart(3)} DESTRUCTION       montant entier détruit = ${r.montant_detruit} (échelle ${scale})`)
    if (r.c_conflit)     console.log(`      C  ${String(r.c_conflit).padStart(3)} CONFLIT réel      (les deux renseignés, valeurs différentes)`)
  }

  console.log(`\n══ SYNTHÈSE : ${totB} ligne(s) en DESTRUCTION, ${totC} ligne(s) en CONFLIT`)

  // Détail des conflits : ils exigent un arbitrage humain, pas une règle.
  if (totC > 0) {
    console.log('\n╔══ DÉTAIL DES CONFLITS (les deux valeurs renseignées et différentes)')
    for (const [tbl, oldc, newc, scale] of COUPLES) {
      if (!nullable.has(`${tbl}.${oldc}`)) continue
      const l = await prisma.$queryRawUnsafe(`
        SELECT "id", "${oldc}" AS ancien, "${newc}" AS nouveau
          FROM "${tbl}"
         WHERE COALESCE("${oldc}",0) <> 0 AND COALESCE("${newc}",0) <> 0
           AND abs("${newc}" - ("${oldc}"::numeric) * ${scale}) > 0.5
         ORDER BY "id" LIMIT 5`)
      if (l.length === 0) continue
      console.log(`── ${tbl}.${oldc} ⇄ ${newc} (échelle ${scale}) — ${l.length} exemple(s)`)
      for (const x of l)
        console.log(`      id=${String(x.id).slice(0, 8)}…  Float=${x.ancien} (→ ${Math.round(Number(x.ancien) * scale)})  entier actuel=${x.nouveau}`)
    }
  }
} catch (e) {
  console.error('Audit impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 500))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

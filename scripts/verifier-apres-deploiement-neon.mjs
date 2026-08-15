/**
 * VÉRIFICATION FINALE LECTURE SEULE, après `npm run db:server:deploy`.
 *
 * Trois preuves distinctes :
 *   1. les lignes nommément identifiées AVANT l'opération comme menacées de
 *      destruction ont conservé leur montant, valeur par valeur ;
 *   2. les colonnes de la migration cible `20260814200000_workshop_half_hours`
 *      existent réellement, avec le bon type ;
 *   3. les anciennes colonnes Float monétaires ont bien disparu.
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/server-client/index.js'

const lireEnv = (n) => {
  let v = null
  for (const l of fs.readFileSync(path.resolve('.env'), 'utf8').split(/\r?\n/))
    if (l.startsWith(`${n}=`)) v = l.slice(n.length + 1).trim().replace(/^["']|["']$/g, '')
  return v
}
const prisma = new PrismaClient({ datasources: { db: { url: lireEnv('DIRECT_URL') } } })

let echecs = 0
const controle = (libelle, obtenu, attendu) => {
  const ok = String(obtenu) === String(attendu)
  if (!ok) echecs++
  console.log(`║  ${ok ? 'OK     ' : 'ÉCHEC  '} ${libelle.padEnd(52)} ${obtenu}${ok ? '' : `  (attendu ${attendu})`}`)
}

try {
  // ── 1. Les lignes autrefois menacées ──────────────────────────────────────
  console.log('╔══ 1. MONTANTS DES LIGNES IDENTIFIÉES COMME MENACÉES AVANT L’OPÉRATION')

  const lignesFacture = await prisma.$queryRawUnsafe(`
    SELECT "unitPriceTenThousandths" AS pu, "quantityTenThousandths" AS q
      FROM "InvoiceLine" WHERE "invoiceId" LIKE 'cmsrmzu7%' ORDER BY "sortOrder", "id"`)
  controle('facture cmsrmzu7… — nombre de lignes', lignesFacture.length, 2)
  const prix = lignesFacture.map((l) => l.pu).sort((a, b) => a - b).join(',')
  const qtes = lignesFacture.map((l) => l.q).sort((a, b) => a - b).join(',')
  controle('  prix unitaires (dix-millièmes)', prix, '340000,600000')
  controle('  quantités (dix-millièmes)', qtes, '10000,20000')

  const [loaner] = await prisma.$queryRawUnsafe(`
    SELECT "dailyRateTenThousandths" AS taux, "depositAmountCents" AS caution
      FROM "LoanerReservation" WHERE "id" LIKE 'cmsjbkpv%'`)
  controle('prêt cmsjbkpv… — tarif journalier (dix-millièmes)', loaner?.taux, 500000)
  controle('prêt cmsjbkpv… — caution (centimes)', loaner?.caution, 19900)

  const [mo] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("unitPriceTenThousandths")::text,'0') AS somme,
           COUNT(*)::int AS lignes,
           count(*) FILTER (WHERE "unitPriceTenThousandths" = 0)::int AS a_zero
      FROM "LaborOperation"`)
  // 53 360 000 provenaient des anciens Float, 26 680 000 n'existaient QUE dans
  // la colonne entière : leur présence dans le total prouve leur conservation.
  controle('LaborOperation — somme des prix (dix-millièmes)', mo.somme, 80040000)
  controle('LaborOperation — nombre d’opérations', mo.lignes, 97)
  console.log(`║         dont ${mo.a_zero} à 0,00 € (opérations sans tarif)`)

  // ── 2. La migration cible a bien produit ses colonnes ─────────────────────
  console.log('\n╔══ 2. COLONNES DE 20260814200000_workshop_half_hours')
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Garage'
       AND column_name IN ('workshopStartMinute','workshopEndMinute')
     ORDER BY column_name`)
  controle('nombre de colonnes créées', cols.length, 2)
  for (const c of cols)
    console.log(`║         Garage.${c.column_name} : ${c.data_type}, nullable=${c.is_nullable}, défaut=${c.column_default}`)
  const [g] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE "workshopStartMinute" IS NULL OR "workshopEndMinute" IS NULL)::int AS nuls
      FROM "Garage"`)
  controle('garages avec les deux minutes renseignées', `${g.n - g.nuls}/${g.n}`, `${g.n}/${g.n}`)

  // ── 3. Les anciennes colonnes Float monétaires ont disparu ────────────────
  console.log('\n╔══ 3. ANCIENNES COLONNES FLOAT MONÉTAIRES')
  const restes = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND (
       (table_name='Garage' AND column_name='hourlyRate')
       OR (table_name IN ('Part','JobPart','QuoteLine','InvoiceLine','LaborOperation')
           AND column_name IN ('unitCost','unitPrice'))
       OR (table_name IN ('QuoteLine','InvoiceLine') AND column_name='quantity')
       OR (table_name='LoanerReservation' AND column_name IN ('dailyRate','depositAmount'))
       OR (table_name IN ('WorkOrder','PurchaseOrder') AND column_name IN ('totalHT','totalTTC')))`)
  controle('colonnes Float monétaires restantes', restes.length, 0)
  for (const r of restes) console.log(`║         reste : ${r.table_name}.${r.column_name}`)

  console.log(`\n══ ${echecs === 0 ? 'Tous les contrôles passent.' : `${echecs} CONTRÔLE(S) EN ÉCHEC.`}`)
  if (echecs > 0) process.exitCode = 1
} catch (e) {
  console.error('Vérification impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 500))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

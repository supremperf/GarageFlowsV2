/**
 * DIAGNOSTIC LECTURE SEULE — arbitrage de l'unique ligne de facture en conflit.
 *
 * Une ligne porte `quantity` (Float) = 1 et `quantityTenThousandths` = 20000
 * (soit 2). Les deux sont renseignés et incompatibles : aucune règle générique ne
 * peut trancher. On confronte donc les deux hypothèses au TOTAL STOCKÉ de la
 * facture — seule preuve indépendante disponible, puisque InvoiceLine ne stocke
 * aucun total de ligne.
 *
 * Aucune écriture. Aucune donnée nominative affichée.
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

const eur = (dixmillemes) => (Number(dixmillemes) / 10000).toFixed(4).replace('.', ',') + ' €'

try {
  const conflits = await prisma.$queryRawUnsafe(`
    SELECT "id", "invoiceId" FROM "InvoiceLine"
     WHERE COALESCE("quantity",0) <> 0 AND COALESCE("quantityTenThousandths",0) <> 0
       AND abs("quantityTenThousandths" - ("quantity"::numeric) * 10000) > 0.5`)
  console.log(`╔══ ${conflits.length} ligne(s) en conflit\n`)

  // Colonnes de total réellement présentes sur Invoice.
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Invoice' ORDER BY column_name`)
  console.log('╔══ colonnes de Invoice')
  console.log('║  ' + cols.map((c) => c.column_name).join(', '))

  for (const c of conflits) {
    const lignes = await prisma.$queryRawUnsafe(`
      SELECT "id", "description", "isLabor", "sortOrder",
             "quantity", "quantityTenThousandths",
             "unitPrice", "unitPriceTenThousandths"
        FROM "InvoiceLine" WHERE "invoiceId" = $1 ORDER BY "sortOrder", "id"`, c.invoiceId)
    const [inv] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Invoice" WHERE "id" = $1`, c.invoiceId)

    console.log(`\n╔══ FACTURE ${String(c.invoiceId).slice(0, 8)}…  (${lignes.length} ligne(s))`)
    for (const [k, v] of Object.entries(inv)) {
      if (/total|amount|ht|ttc|tva|vat|cents|remise|discount/i.test(k))
        console.log(`║   ${k} = ${v}`)
    }
    console.log(`║   statut=${inv.status ?? '?'}  créée=${inv.createdAt?.toISOString?.().slice(0, 10) ?? '?'}`)

    // Deux hypothèses pour la ligne en conflit.
    let sommeSiFloat = 0n, sommeSiEntier = 0n
    console.log('║')
    for (const l of lignes) {
      const pu = BigInt(l.unitPriceTenThousandths ?? 0)
      const puFloat = BigInt(Math.round(Number(l.unitPrice ?? 0) * 10000))
      // Prix unitaire retenu : la valeur non nulle (une seule des deux l'est ici).
      const prix = pu !== 0n ? pu : puFloat
      const qFloat = BigInt(Math.round(Number(l.quantity ?? 0) * 10000))
      const qEntier = BigInt(l.quantityTenThousandths ?? 0)
      sommeSiFloat += prix * qFloat / 10000n
      sommeSiEntier += prix * qEntier / 10000n
      const marque = l.id === c.id ? '>>' : '  '
      console.log(`║ ${marque} «${String(l.description).slice(0, 34).padEnd(34)}» MO=${l.isLabor ? 'oui' : 'non'}`)
      console.log(`║      quantity(Float)=${l.quantity}  quantityTenThousandths=${l.quantityTenThousandths}`)
      console.log(`║      unitPrice(Float)=${l.unitPrice}  unitPriceTenThousandths=${l.unitPriceTenThousandths}`)
    }
    console.log('║')
    console.log(`║   TOTAL HT recalculé — hypothèse « Float fait foi »  : ${eur(sommeSiFloat)}`)
    console.log(`║   TOTAL HT recalculé — hypothèse « entier fait foi » : ${eur(sommeSiEntier)}`)
  }
} catch (e) {
  console.error('Diagnostic impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 500))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

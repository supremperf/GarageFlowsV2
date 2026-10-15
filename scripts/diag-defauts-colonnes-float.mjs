/**
 * DIAGNOSTIC LECTURE SEULE — valeurs par défaut des anciennes colonnes Float.
 *
 * Sert à établir qu'un `0` (ou un `1`) trouvé dans une ancienne colonne Float sur
 * une ligne récente est la VALEUR PAR DÉFAUT de la colonne, et non une donnée
 * saisie : le schéma serveur ne déclare plus ces colonnes, donc Prisma Client ne
 * peut plus les écrire.
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

try {
  const r = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND (
       (table_name='InvoiceLine'    AND column_name IN ('quantity','unitPrice','unitCost'))
       OR (table_name='QuoteLine'   AND column_name IN ('quantity','unitPrice','unitCost'))
       OR (table_name='LaborOperation' AND column_name='unitPrice')
       OR (table_name='Part'        AND column_name IN ('unitPrice','unitCost'))
       OR (table_name='Garage'      AND column_name='hourlyRate')
       OR (table_name='LoanerReservation' AND column_name IN ('dailyRate','depositAmount')))
     ORDER BY table_name, column_name`)
  for (const c of r)
    console.log(`${(c.table_name + '.' + c.column_name).padEnd(34)} ${c.data_type.padEnd(17)} nullable=${c.is_nullable}  défaut=${c.column_default ?? 'AUCUN'}`)
} catch (e) {
  console.error('Diagnostic impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 400))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

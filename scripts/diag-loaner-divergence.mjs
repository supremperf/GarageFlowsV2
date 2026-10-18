/**
 * DIAGNOSTIC LECTURE SEULE — la ligne LoanerReservation qui bloque
 * `20260807000000_money_scaled_units`.
 *
 * Le contrôle de la migration lève une exception sans dire QUELLE ligne ni
 * LAQUELLE des quatre conditions a déclenché. On les réévalue donc une par une,
 * à l'identique du SQL de la migration, pour attribuer la cause exacte avant
 * d'envisager la moindre écriture.
 *
 * Aucune donnée nominative n'est affichée : identifiants et montants seulement.
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

try {
  // ── Les 4 conditions du contrôle, séparément (mêmes expressions que le SQL) ──
  const [c] = await prisma.$queryRawUnsafe(`
    SELECT
      count(*) FILTER (WHERE "dailyRate" IS NOT NULL AND ("dailyRateTenThousandths" IS NULL
              OR abs("dailyRateTenThousandths" - ("dailyRate"::numeric) * 10000) > 0.5))::int AS c1_taux_divergent,
      count(*) FILTER (WHERE "dailyRate" IS NULL AND "dailyRateTenThousandths" IS NOT NULL)::int AS c2_taux_orphelin,
      count(*) FILTER (WHERE "depositAmount" IS NOT NULL AND ("depositAmountCents" IS NULL
              OR abs("depositAmountCents" - ("depositAmount"::numeric) * 100) > 0.5))::int AS c3_caution_divergente,
      count(*) FILTER (WHERE "depositAmount" IS NULL AND "depositAmountCents" IS NOT NULL)::int AS c4_caution_orpheline,
      count(*)::int AS total
    FROM "LoanerReservation"`)

  console.log('╔══ ATTRIBUTION DE LA CAUSE (conditions du contrôle, une par une)')
  console.log(`║  total lignes ................................ ${c.total}`)
  console.log(`║  C1  taux : Float renseigné, entier absent/faux  ${c.c1_taux_divergent}`)
  console.log(`║  C2  taux : Float NULL mais entier renseigné ... ${c.c2_taux_orphelin}`)
  console.log(`║  C3  caution : Float renseigné, cents absents/faux ${c.c3_caution_divergente}`)
  console.log(`║  C4  caution : Float NULL mais cents renseignés   ${c.c4_caution_orpheline}`)

  // ── Détail non nominatif de toutes les lignes ────────────────────────────────
  const lignes = await prisma.$queryRawUnsafe(`
    SELECT "id", "garageId", "createdAt",
           "dailyRate", "dailyRateTenThousandths",
           "depositAmount", "depositAmountCents"
      FROM "LoanerReservation" ORDER BY "createdAt" ASC`)
  console.log('\n╔══ DÉTAIL des lignes (montants uniquement)')
  for (const l of lignes) {
    const div = (l.dailyRate === null && l.dailyRateTenThousandths !== null)
      || (l.depositAmount === null && l.depositAmountCents !== null)
      || (l.dailyRate !== null && l.dailyRateTenThousandths === null)
      || (l.depositAmount !== null && l.depositAmountCents === null)
    console.log(`║  ${div ? '>> BLOQUANTE' : '   conforme '}  id=${String(l.id).slice(0, 8)}…  créée=${l.createdAt?.toISOString?.().slice(0, 10) ?? '?'}`)
    console.log(`║        dailyRate(float)=${l.dailyRate ?? 'NULL'}   dailyRateTenThousandths=${l.dailyRateTenThousandths ?? 'NULL'}`)
    console.log(`║        depositAmount(float)=${l.depositAmount ?? 'NULL'}   depositAmountCents=${l.depositAmountCents ?? 'NULL'}`)
  }

  // ── La migration a-t-elle laissé une trace / un effet partiel ? ──────────────
  const hist = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at, rolled_back_at, applied_steps_count,
           (logs IS NOT NULL) AS a_des_logs
      FROM _prisma_migrations
     WHERE migration_name LIKE '20260806%' OR migration_name LIKE '20260807%'
        OR migration_name LIKE '202608041%' OR migration_name LIKE '20260805%'
     ORDER BY started_at ASC`)
  console.log('\n╔══ HISTORIQUE Prisma après l’échec')
  for (const m of hist) {
    const etat = m.rolled_back_at ? 'ANNULÉE ' : (m.finished_at ? 'terminée' : 'ÉCHOUÉE ')
    console.log(`║  [${etat}] steps=${m.applied_steps_count} logs=${m.a_des_logs ? 'oui' : 'non'}  ${m.migration_name}`)
  }
} catch (e) {
  console.error('Diagnostic impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 400))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

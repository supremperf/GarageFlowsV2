/**
 * RÉPARATION CIBLÉE — remettre les anciennes colonnes Float en accord avec les
 * colonnes entières, AVANT de rejouer `20260807000000_money_scaled_units`.
 *
 * ── Cause racine ────────────────────────────────────────────────────────────
 * Le schéma serveur ne déclare plus les anciennes colonnes Float (`unitPrice`,
 * `quantity`, `dailyRate`, `depositAmount`…) : Prisma Client ne peut donc plus
 * les écrire. Toute ligne créée depuis porte le montant UNIQUEMENT dans la
 * colonne entière, l'ancienne colonne restant à NULL ou à son défaut (0, ou 1
 * pour les quantités). Or `money_scaled_units` recalcule l'entier depuis le
 * Float SANS CONDITION : sur ces lignes, il remplacerait un montant réel par une
 * valeur dérivée du vide — et son propre contrôle ne verrait rien, le résultat
 * étant cohérent avec sa source.
 *
 * ── Ce que fait ce script ───────────────────────────────────────────────────
 * Il écrit UNIQUEMENT dans les anciennes colonnes Float, et seulement sur les
 * lignes où celles-ci ne portent aucune information (NULL, ou défaut de colonne)
 * alors que l'entier porte une valeur. Aucune colonne entière n'est modifiée :
 * c'est l'invariant vérifié en fin de script (sommes identiques avant/après).
 *
 * Après réparation, le recalcul de `money_scaled_units` reproduit à l'identique
 * les entiers existants (donc aucune perte), et la vérification par colonne de
 * `money_drop_floats` passe puisque les deux représentations concordent.
 *
 * Les colonnes Float ainsi remplies sont de toute façon SUPPRIMÉES deux
 * migrations plus loin : leur contenu est transitoire.
 *
 * Idempotent. Transactionnel. Refuse de s'exécuter si le nombre de lignes
 * concernées ne correspond pas à l'audit (garde anti-dérive).
 *
 * Usage : node scripts/reparer-coherence-float-entier.mjs [--appliquer]
 *         (sans --appliquer : simulation, aucune écriture)
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/server-client/index.js'

const APPLIQUER = process.argv.includes('--appliquer')

const lireEnv = (n) => {
  let v = null
  for (const l of fs.readFileSync(path.resolve('.env'), 'utf8').split(/\r?\n/))
    if (l.startsWith(`${n}=`)) v = l.slice(n.length + 1).trim().replace(/^["']|["']$/g, '')
  return v
}
const prisma = new PrismaClient({ datasources: { db: { url: lireEnv('DIRECT_URL') } } })

/**
 * Une entrée = une colonne Float à remettre en accord.
 *   predicat : ce qui caractérise « le Float ne porte aucune information ».
 *   attendu  : nombre de lignes constaté par l'audit — garde anti-dérive.
 */
const REPARATIONS = [
  { tbl: 'InvoiceLine', flottant: 'unitPrice', entier: 'unitPriceTenThousandths', echelle: 10000,
    predicat: `"unitPrice" = 0 AND "unitPriceTenThousandths" <> 0`, attendu: 2 },
  { tbl: 'InvoiceLine', flottant: 'quantity', entier: 'quantityTenThousandths', echelle: 10000,
    predicat: `"quantity" = 1 AND "quantityTenThousandths" <> 10000`, attendu: 1 },
  { tbl: 'LaborOperation', flottant: 'unitPrice', entier: 'unitPriceTenThousandths', echelle: 10000,
    predicat: `"unitPrice" = 0 AND "unitPriceTenThousandths" <> 0`, attendu: 32 },
  { tbl: 'LoanerReservation', flottant: 'dailyRate', entier: 'dailyRateTenThousandths', echelle: 10000,
    predicat: `"dailyRate" IS NULL AND "dailyRateTenThousandths" IS NOT NULL`, attendu: 1 },
  { tbl: 'LoanerReservation', flottant: 'depositAmount', entier: 'depositAmountCents', echelle: 100,
    predicat: `"depositAmount" IS NULL AND "depositAmountCents" IS NOT NULL`, attendu: 1 },
]

/** Sommes des colonnes entières monétaires — doivent être INCHANGÉES. */
const TEMOINS = [
  ['Garage', 'hourlyRateTenThousandths'], ['Part', 'unitCostTenThousandths'],
  ['Part', 'unitPriceTenThousandths'], ['QuoteLine', 'quantityTenThousandths'],
  ['QuoteLine', 'unitPriceTenThousandths'], ['QuoteLine', 'unitCostTenThousandths'],
  ['InvoiceLine', 'quantityTenThousandths'], ['InvoiceLine', 'unitPriceTenThousandths'],
  ['InvoiceLine', 'unitCostTenThousandths'], ['LaborOperation', 'unitPriceTenThousandths'],
  ['LoanerReservation', 'dailyRateTenThousandths'], ['LoanerReservation', 'depositAmountCents'],
]

const sommes = async () => {
  const out = {}
  for (const [t, c] of TEMOINS) {
    const [r] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("${c}")::numeric,0)::text AS s, COUNT("${c}")::int AS n FROM "${t}"`)
    out[`${t}.${c}`] = `${r.s}/${r.n}`
  }
  return out
}

try {
  console.log(APPLIQUER ? '╔══ MODE ÉCRITURE\n' : '╔══ SIMULATION (aucune écriture) — relancer avec --appliquer\n')

  // ── Garde anti-dérive : les volumes doivent correspondre à l'audit ──────────
  let derive = false
  for (const r of REPARATIONS) {
    const [c] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${r.tbl}" WHERE ${r.predicat}`)
    const ok = c.n === r.attendu
    if (!ok) derive = true
    console.log(`${ok ? '  ' : '!!'} ${r.tbl}.${r.flottant.padEnd(14)} ${String(c.n).padStart(3)} ligne(s) — attendu ${r.attendu}`)
  }
  if (derive) {
    console.error('\nARRÊT : les volumes ne correspondent plus à l’audit. Rien n’a été écrit.')
    process.exitCode = 1
  } else {
    const avant = await sommes()

    if (APPLIQUER) {
      const ordres = REPARATIONS.map((r) => prisma.$executeRawUnsafe(
        `UPDATE "${r.tbl}" SET "${r.flottant}" = ("${r.entier}"::numeric) / ${r.echelle} WHERE ${r.predicat}`))
      const n = await prisma.$transaction(ordres)
      console.log(`\n╔══ ÉCRIT (transaction unique)`)
      REPARATIONS.forEach((r, i) => console.log(`║  ${String(n[i]).padStart(3)} ligne(s)  ${r.tbl}.${r.flottant}`))
    }

    const apres = await sommes()
    console.log(`\n╔══ INVARIANT — sommes des colonnes ENTIÈRES (somme/renseignés)`)
    let casse = false
    for (const k of Object.keys(avant)) {
      const identique = avant[k] === apres[k]
      if (!identique) casse = true
      console.log(`║  ${identique ? 'inchangé' : '!! MODIFIÉ'}  ${k.padEnd(42)} ${avant[k]}${identique ? '' : ` → ${apres[k]}`}`)
    }
    console.log(casse
      ? '\n══ ÉCHEC : une colonne entière a bougé — à investiguer immédiatement.'
      : '\n══ Aucune colonne monétaire entière n’a été modifiée.')
    if (casse) process.exitCode = 1

    // ── Contrôle final : reste-t-il des lignes que le recalcul DÉTRUIRAIT ? ───
    // On ne compte QUE les lignes menacées (Float vide/défaut, entier renseigné).
    // Les lignes où le Float porte la valeur et l'entier est vide sont, elles,
    // le backfill légitime que la migration est censée réaliser.
    console.log('\n╔══ Lignes encore MENACÉES par le recalcul de money_scaled_units')
    let restant = 0
    for (const r of REPARATIONS) {
      const [c] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${r.tbl}" WHERE ${r.predicat}`)
      restant += c.n
      console.log(`║  ${c.n === 0 ? 'OK      ' : '!! RESTE'} ${r.tbl}.${r.flottant} → ${c.n} ligne(s) menacée(s)`)
    }
    console.log(restant === 0
      ? '\n══ Plus aucune ligne menacée : le recalcul reproduira les entiers à l’identique.'
      : `\n══ ${restant} ligne(s) encore menacée(s)${APPLIQUER ? ' — ANOMALIE' : ' (normal en simulation)'}.`)
  }
} catch (e) {
  console.error('Réparation impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 500))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

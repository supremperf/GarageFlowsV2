/**
 * AUDIT LECTURE SEULE — migration `20260804000000_mechanic_licenses` ⇄ Neon.
 *
 * Confronte CHAQUE opération du fichier SQL à l'état réel de la base, colonne
 * par colonne, index par index, contrainte par contrainte. Aucune écriture,
 * aucune modification : uniquement des SELECT sur les catalogues système.
 *
 * Motif : `migrate deploy` a échoué sur « column "parentLicenseId" already
 * exists » (42701). Une migration marquée appliquée sans vérification laisserait
 * un schéma incomplet derrière un historique qui prétend le contraire. On ne
 * conclut donc PAS depuis une seule colonne.
 *
 * Usage : node scripts/audit-neon-mechanic-licenses.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/server-client/index.js'

// ── URL de connexion : DIRECT_URL (non poolée), jamais affichée ──────────────
function lireEnv(nom) {
  const contenu = fs.readFileSync(path.resolve('.env'), 'utf8')
  // La DERNIÈRE occurrence gagne, comme dotenv.
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

// ── Ce que la migration DOIT avoir produit ──────────────────────────────────
const COLONNES = [
  ['LicenseKey', 'parentLicenseId'], ['LicenseKey', 'mechanicId'],
  ['LicenseKey', 'mechanicHint'],    ['LicenseKey', 'assignedAt'],
  ['LicenseKey', 'assignedBy'],      ['LicenseKey', 'suspendedAt'],
  ['JobPhoto',   'mechanicId'],
]

const TABLES = ['MechanicLicenseAssignment', 'JobMechanicNote', 'MechanicActionAudit']

const INDEX = [
  'LicenseKey_parentLicenseId_idx', 'LicenseKey_garageId_licenseType_idx',
  'LicenseKey_mechanicId_idx', 'LicenseKey_assignedBy_idx',
  'MechanicLicenseAssignment_licenseId_assignedAt_idx',
  'MechanicLicenseAssignment_garageId_idx',
  'MechanicLicenseAssignment_mechanicId_idx',
  'MechanicLicenseAssignment_assignedBy_idx',
  'MechanicLicenseAssignment_previousMechanicId_idx',
  'JobMechanicNote_jobId_createdAt_idx', 'JobMechanicNote_garageId_mechanicId_idx',
  'JobMechanicNote_licenseId_idx',
  'MechanicActionAudit_garageId_createdAt_idx',
  'MechanicActionAudit_targetMechanicId_createdAt_idx',
  'MechanicActionAudit_actorUserId_createdAt_idx',
  'MechanicActionAudit_jobId_idx', 'MechanicActionAudit_licenseId_idx',
]

const CONTRAINTES = [
  'LicenseKey_parentLicenseId_fkey', 'LicenseKey_mechanicId_fkey', 'LicenseKey_assignedBy_fkey',
  'MechanicLicenseAssignment_garageId_fkey', 'MechanicLicenseAssignment_licenseId_fkey',
  'MechanicLicenseAssignment_mechanicId_fkey', 'MechanicLicenseAssignment_assignedBy_fkey',
  'MechanicLicenseAssignment_previousMechanicId_fkey',
  'JobMechanicNote_jobId_fkey', 'JobMechanicNote_garageId_fkey',
  'JobMechanicNote_mechanicId_fkey', 'JobMechanicNote_licenseId_fkey',
  'MechanicActionAudit_garageId_fkey', 'MechanicActionAudit_actorUserId_fkey',
  'MechanicActionAudit_targetMechanicId_fkey', 'MechanicActionAudit_licenseId_fkey',
  'MechanicActionAudit_jobId_fkey',
  'MechanicLicenseAssignment_pkey', 'JobMechanicNote_pkey', 'MechanicActionAudit_pkey',
]

const manquants = { colonnes: [], tables: [], index: [], contraintes: [] }

try {
  // ── Historique Prisma ─────────────────────────────────────────────────────
  const hist = await prisma.$queryRawUnsafe(
    `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
       FROM _prisma_migrations ORDER BY started_at ASC`)
  console.log(`\n╔══ _prisma_migrations : ${hist.length} enregistrement(s)`)
  for (const m of hist) {
    const etat = m.rolled_back_at ? 'ANNULÉE  ' : (m.finished_at ? 'terminée ' : 'INACHEVÉE')
    console.log(`║  [${etat}] steps=${String(m.applied_steps_count).padStart(2)}  ${m.migration_name}`)
  }

  // ── Colonnes ──────────────────────────────────────────────────────────────
  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public'`)
  const cle = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`))

  console.log('\n╔══ COLONNES attendues')
  for (const [t, c] of COLONNES) {
    const ok = cle.has(`${t}.${c}`)
    if (!ok) manquants.colonnes.push([t, c])
    const info = cols.find((x) => x.table_name === t && x.column_name === c)
    console.log(`║  ${ok ? 'OK     ' : 'MANQUE '} ${t}.${c}${info ? `  (${info.data_type}, nullable=${info.is_nullable})` : ''}`)
  }

  // ── Tables ────────────────────────────────────────────────────────────────
  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
  const tset = new Set(tbl.map((t) => t.table_name))
  console.log('\n╔══ TABLES attendues')
  for (const t of TABLES) {
    const ok = tset.has(t)
    if (!ok) manquants.tables.push(t)
    console.log(`║  ${ok ? 'OK     ' : 'MANQUE '} ${t}`)
  }

  // ── Index ─────────────────────────────────────────────────────────────────
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)
  const iset = new Set(idx.map((i) => i.indexname))
  console.log('\n╔══ INDEX attendus')
  for (const i of INDEX) {
    const ok = iset.has(i)
    if (!ok) manquants.index.push(i)
    console.log(`║  ${ok ? 'OK     ' : 'MANQUE '} ${i}`)
  }

  // ── Contraintes (FK + PK) ─────────────────────────────────────────────────
  const con = await prisma.$queryRawUnsafe(
    `SELECT conname, contype FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`)
  const cset = new Map(con.map((c) => [c.conname, c.contype]))
  console.log('\n╔══ CONTRAINTES attendues (clés étrangères + primaires)')
  for (const c of CONTRAINTES) {
    const ok = cset.has(c)
    if (!ok) manquants.contraintes.push(c)
    console.log(`║  ${ok ? 'OK     ' : 'MANQUE '} ${c}${ok ? `  (type=${cset.get(c)})` : ''}`)
  }

  // ── Volumétrie : preuve qu'aucune donnée n'est perdue ─────────────────────
  console.log('\n╔══ VOLUMÉTRIE (avant toute intervention)')
  for (const t of ['Garage', 'User', 'LicenseKey', 'Job', 'Invoice', 'Quote', 'Part', 'Mechanic', 'Client']) {
    if (!tset.has(t)) { console.log(`║  (table ${t} absente)`); continue }
    const [r] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`)
    console.log(`║  ${String(r.n).padStart(6)}  ${t}`)
  }

  const total = manquants.colonnes.length + manquants.tables.length
    + manquants.index.length + manquants.contraintes.length
  console.log(`\n══ VERDICT : ${total === 0
    ? 'migration INTÉGRALEMENT présente en base'
    : `${total} opération(s) MANQUANTE(S)`}`)
  if (total > 0) console.log(JSON.stringify(manquants, null, 2))
} catch (e) {
  console.error('Audit impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 400))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

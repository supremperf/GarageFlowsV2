/**
 * AUDIT LECTURE SEULE — chaque migration locale non enregistrée ⇄ état réel Neon.
 *
 * Pour chaque migration en attente, on extrait du SQL les objets qu'elle crée
 * (colonnes, tables, index, contraintes) et l'on regarde s'ils existent DÉJÀ.
 * Objectif : savoir AVANT de lancer `migrate deploy` lesquelles vont buter sur
 * « already exists », lesquelles sont réellement absentes, et lesquelles sont à
 * moitié là — plutôt que d'enchaîner des `resolve --applied` à l'aveugle.
 *
 * Aucune écriture. Uniquement des SELECT sur les catalogues système.
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/server-client/index.js'

function lireEnv(nom) {
  const contenu = fs.readFileSync(path.resolve('.env'), 'utf8')
  let valeur = null
  for (const ligne of contenu.split(/\r?\n/)) {
    if (ligne.startsWith(`${nom}=`)) valeur = ligne.slice(nom.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return valeur
}

const url = lireEnv('DIRECT_URL') ?? lireEnv('DATABASE_URL')
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** Retire les commentaires SQL (`--` en fin de ligne, puis blocs). */
const sansCommentaires = (sql) =>
  sql.replace(/^[ \t]*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Objets créés/supprimés par une migration, extraits de son SQL. */
function analyser(sql) {
  const s = sansCommentaires(sql)
  const ops = []
  const ajouter = (type, nom, brut) => ops.push({ type, nom, brut })

  for (const m of s.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    ajouter('colonne', `${m[1]}.${m[2]}`, m[0])
  for (const m of s.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi))
    ajouter('colonne-supprimée', `${m[1]}.${m[2]}`, m[0])
  for (const m of s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    ajouter('table', m[1], m[0])
  for (const m of s.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
    ajouter('index', m[1], m[0])
  for (const m of s.matchAll(/ADD\s+CONSTRAINT\s+"?(\w+)"?/gi))
    ajouter('contrainte', m[1], m[0])
  for (const m of s.matchAll(/UPDATE\s+"?(\w+)"?\s+SET/gi))
    ajouter('DONNÉES-update', m[1], m[0])
  for (const m of s.matchAll(/INSERT\s+INTO\s+"?(\w+)"?/gi))
    ajouter('DONNÉES-insert', m[1], m[0])
  return ops
}

try {
  const hist = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)
  const enregistrees = new Set(hist.map((h) => h.migration_name))

  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)
  const colSet = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`))
  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
  const tblSet = new Set(tbl.map((t) => t.table_name))
  const idx = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)
  const idxSet = new Set(idx.map((i) => i.indexname))
  const con = await prisma.$queryRawUnsafe(
    `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'`)
  const conSet = new Set(con.map((c) => c.conname))

  const present = (op) => {
    switch (op.type) {
      case 'colonne':           return colSet.has(op.nom)
      case 'colonne-supprimée': return !colSet.has(op.nom)   // « fait » = absente
      case 'table':             return tblSet.has(op.nom)
      case 'index':             return idxSet.has(op.nom)
      case 'contrainte':        return conSet.has(op.nom)
      default:                  return null                  // données : indécidable ici
    }
  }

  const racine = 'prisma/server/migrations'
  const dossiers = fs.readdirSync(racine).filter((d) => fs.statSync(path.join(racine, d)).isDirectory()).sort()
  const enAttente = dossiers.filter((d) => !enregistrees.has(d))

  console.log(`\n${dossiers.length} migrations locales · ${enregistrees.size} enregistrées en base · ${enAttente.length} EN ATTENTE\n`)

  const resume = []
  for (const d of enAttente) {
    const sql = fs.readFileSync(path.join(racine, d, 'migration.sql'), 'utf8')
    const ops = analyser(sql)
    const faites = ops.filter((o) => present(o) === true)
    const absentes = ops.filter((o) => present(o) === false)
    const donnees = ops.filter((o) => present(o) === null)

    let etat
    if (ops.length === 0) etat = 'SQL NON ANALYSÉ (à lire à la main)'
    else if (absentes.length === 0 && donnees.length === 0) etat = 'DÉJÀ INTÉGRALEMENT EN BASE'
    else if (faites.length === 0) etat = 'entièrement à appliquer'
    else etat = `PARTIELLE — ${faites.length} déjà là, ${absentes.length} absente(s)`

    resume.push({ d, etat, ops: ops.length, faites: faites.length, absentes: absentes.length, donnees: donnees.length })
    console.log(`── ${d}`)
    console.log(`   ${etat}${donnees.length ? `  [${donnees.length} opération(s) sur les DONNÉES]` : ''}`)
    for (const o of absentes) console.log(`      ABSENT  ${o.type.padEnd(18)} ${o.nom}`)
    for (const o of donnees)  console.log(`      DONNÉES ${o.type.padEnd(18)} ${o.nom}`)
  }

  console.log('\n══ SYNTHÈSE')
  for (const r of resume) console.log(`   ${r.d.padEnd(48)} ${r.etat}`)
} catch (e) {
  console.error('Audit impossible :', String(e.message ?? e)
    .replace(/postgres(ql)?:\/\/\S+/g, '<URL MASQUÉE>').slice(0, 400))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

#!/usr/bin/env node
/**
 * validate-server-db.js — Vérification d'une installation PostgreSQL neuve.
 *
 * Usage :  DATABASE_URL=postgresql://… [DIRECT_URL=…] npm run db:server:check
 *
 * Étapes (toutes obligatoires, échec = code de sortie ≠ 0) :
 *   1. DATABASE_URL doit être une URL PostgreSQL (jamais SQLite) ;
 *   2. prisma migrate deploy --schema prisma/server/schema.prisma ;
 *   3. prisma migrate status : aucune migration en attente ;
 *   4. smoke test CRUD via le client serveur généré : création d'une licence,
 *      d'un appareil, lecture, contrainte d'unicité (licenseId, hwidHash),
 *      cascade de suppression — puis nettoyage complet.
 *
 * Aucune modification manuelle de la base ne doit être nécessaire après
 * `prisma migrate deploy` : ce script le prouve sur une base vide.
 */

'use strict'

const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const SCHEMA = 'prisma/server/schema.prisma'

function fail(msg) {
  console.error(`❌  ${msg}`)
  process.exit(1)
}

// Les lanceurs de node_modules/.bin ne sont pas exécutables directement :
// sous Windows ce sont des `.cmd`, et depuis Node 18.20/20.12 `execFile` les
// REFUSE (EINVAL) sauf à activer `shell: true` — ce qui rouvrirait les questions
// de découpage d'arguments. On exécute donc l'entrée JS de chaque CLI avec le
// Node courant : portable, sans shell, et insensible à PATHEXT.
function run(args) {
  const cli = require.resolve('prisma/build/index.js')
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL },
  }).toString()
}

/**
 * Crée la base cible si elle n'existe pas (connexion à la base de maintenance
 * « postgres »). Rend le script autonome : aucune création manuelle nécessaire
 * avant `prisma migrate deploy`, ni dépendance au comportement d'auto-création
 * de Prisma (qui n'est pas garanti selon les privilèges).
 */
async function ensureDatabase(url) {
  const u = new URL(url)
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
  // Garde-fou anti-injection : la base vient de notre propre configuration.
  if (!/^[A-Za-z0-9_]+$/.test(name)) fail(`Nom de base invalide : ${name}`)

  const admin = new URL(url)
  admin.pathname = '/postgres'

  const { PrismaClient } = require(path.join(root, 'src', 'generated', 'server-client'))
  const client = new PrismaClient({ datasourceUrl: admin.toString() })
  try {
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    console.log(`✅  Base « ${name} » créée.`)
  } catch (err) {
    const msg = String(err && err.message ? err.message : err)
    // 42P04 / "already exists" : la base existe déjà — parfait.
    if (!/already exists|42P04|P2010/i.test(msg)) {
      fail(`Création de la base « ${name} » impossible : ${msg}`)
    }
    console.log(`ℹ️   Base « ${name} » déjà présente.`)
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    fail('DATABASE_URL doit être une URL postgresql:// (base serveur). SQLite est réservé au desktop.')
  }

  // ── 0. Base cible : créée si absente (aucune étape manuelle requise) ─────────
  console.log('▶  Vérification/création de la base cible…')
  await ensureDatabase(process.env.DIRECT_URL || url)

  // ── 1. Migrations ───────────────────────────────────────────────────────────
  console.log('▶  prisma migrate deploy…')
  try {
    const out = run(['migrate', 'deploy', '--schema', SCHEMA])
    process.stdout.write(out)
  } catch (err) {
    fail(`migrate deploy a échoué : ${err.message}`)
  }

  console.log('▶  prisma migrate status…')
  try {
    const out = run(['migrate', 'status', '--schema', SCHEMA])
    process.stdout.write(out)
    if (/have not yet been applied|following migrations? have failed/i.test(out)) {
      fail('Des migrations sont en attente ou en échec.')
    }
  } catch (err) {
    fail(`migrate status a échoué : ${err.message}`)
  }

  // ── 1bis. Migration JSON monétaire v1 → v2 (exécution RÉELLE) ───────────────
  // Fait partie du déploiement standard (docs/MIGRATION-MONEY.md) : la lancer
  // ici prouve qu'elle s'exécute de bout en bout (base vide → 0 document,
  // base existante → migration effective ou ÉCHEC bloquant).
  console.log('▶  Migration JSON monétaire v1 → v2 (scripts/migrate-money-json.ts)…')
  try {
    // Même raison que `run()` ci-dessus : entrée JS + Node courant, jamais le
    // lanceur .bin (`.cmd` refusé par execFile depuis Node 18.20/20.12).
    const tsNodeCli = require.resolve('ts-node/dist/bin.js')
    const out = execFileSync(
      process.execPath,
      [tsNodeCli, '--project', 'tsconfig.scripts.json', 'scripts/migrate-money-json.ts'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
    ).toString()
    process.stdout.write(out)
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString() : err.message
    fail(`Migration JSON v2 échouée : ${detail}`)
  }

  // ── 2. Smoke test CRUD via le client serveur ────────────────────────────────
  console.log('▶  Smoke test CRUD (LicenseKey + LicenseDevice)…')
  const { PrismaClient } = require(path.join(root, 'src', 'generated', 'server-client'))
  const db = new PrismaClient()
  const lid = `validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    await db.$queryRaw`SELECT 1`

    const lic = await db.licenseKey.create({
      data: {
        licenseId:   lid,
        token:       `GF2.validate.${lid}`,
        customerId:  'validate-script',
        licenseType: 'trial',
        expiryAt:    new Date(Date.now() + 24 * 3600 * 1000),
        status:      'active',
        seats:       1,
      },
    })

    const dev = await db.licenseDevice.create({
      data: {
        licenseId: lic.licenseId,
        hwidHash:  `hw-${lid}`,
        tokenHash: `tk-${lid}`,
      },
    })

    // Contrainte @@unique([licenseId, hwidHash]) réellement appliquée ?
    let uniqueOk = false
    try {
      await db.licenseDevice.create({
        data: { licenseId: lic.licenseId, hwidHash: `hw-${lid}`, tokenHash: `tk2-${lid}` },
      })
    } catch (e) {
      uniqueOk = e && e.code === 'P2002'
    }
    if (!uniqueOk) fail('La contrainte unique (licenseId, hwidHash) n\'est pas appliquée.')

    const count = await db.licenseDevice.count({ where: { licenseId: lic.licenseId } })
    if (count !== 1) fail(`Comptage d'appareils inattendu : ${count} (attendu 1).`)

    // Cascade : supprimer la licence doit supprimer ses appareils.
    await db.licenseKey.delete({ where: { id: lic.id } })
    const orphan = await db.licenseDevice.findUnique({ where: { id: dev.id } })
    if (orphan) fail('La suppression en cascade licence → appareils ne fonctionne pas.')

    console.log('✅  Base serveur PostgreSQL valide : migrations appliquées, contraintes et cascade vérifiées.')
  } finally {
    // Nettoyage best-effort si un échec a laissé la licence de test.
    try { await db.licenseKey.deleteMany({ where: { licenseId: lid } }) } catch (_) {}
    await db.$disconnect()
  }
}

main().catch((err) => fail(err.message))

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

function run(args) {
  const bin = path.join(
    root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
  )
  return execFileSync(bin, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL },
  }).toString()
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    fail('DATABASE_URL doit être une URL postgresql:// (base serveur). SQLite est réservé au desktop.')
  }

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

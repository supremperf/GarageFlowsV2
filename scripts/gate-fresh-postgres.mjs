#!/usr/bin/env node
/**
 * gate-fresh-postgres.mjs — étape conditionnelle de la porte de release :
 * rejoue TOUTES les migrations serveur sur une base VIERGE, puis lance le smoke
 * test. Une migration qui ne passe que sur la base déjà migrée de l'opérateur
 * est un piège classique — seule une base neuve le révèle.
 *
 * Extrait de final-release-gate.mjs, où l'étape était écrite en shell POSIX
 * (`sh -c` + expansion `${VAR%/*}`) : ni `sh` ni cette expansion n'existent sous
 * Windows, la plateforme cible du produit. En JavaScript, la même logique tourne
 * partout, et l'URL est dérivée par l'analyseur d'URL plutôt que par découpage
 * de chaîne — ce qui préserve les paramètres de connexion (sslmode…) que le
 * découpage `%/*` supprimait silencieusement avec le nom de base.
 *
 * Usage : TEST_POSTGRES_URL=postgres://… node scripts/gate-fresh-postgres.mjs
 */
import { spawnSync } from 'node:child_process'
import { temporaryPostgresDatabaseName } from './lib/postgres-test-database.mjs'

const SOURCE = process.env.TEST_POSTGRES_URL
// Une base neuve à identifiant unique : toute collision fait échouer la création.
// Elle est conservée après le contrôle ; aucune suppression n'est automatisée.
const SCRATCH_DB = temporaryPostgresDatabaseName()

if (!SOURCE) {
  console.error('TEST_POSTGRES_URL est requis (base d\'administration servant à créer la base de contrôle).')
  process.exit(2)
}

let gateUrl
try {
  const u = new URL(SOURCE)
  u.pathname = `/${SCRATCH_DB}`
  gateUrl = u.toString()
} catch (e) {
  console.error(`TEST_POSTGRES_URL n'est pas une URL exploitable : ${e.message}`)
  process.exit(2)
}

/** Lance sans shell : aucun caractère de l'URL (mot de passe compris) n'est réinterprété. */
function step(label, file, args, env = {}) {
  const r = spawnSync(file, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } })
  if (r.error) {
    console.error(`✗ ${label} — lancement impossible : ${r.error.message}`)
    if (r.error.code === 'ENOENT') console.error(`  « ${file} » est introuvable sur le PATH.`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`✗ ${label} — code de sortie ${r.status}`)
    process.exit(r.status ?? 1)
  }
}

// `psql -d <url>` et NON `psql <url>` : sous Windows, getopt cesse d'analyser les
// options dès le premier argument positionnel — les `-c` étaient alors ignorés en
// silence (la glibc, elle, les permute, d'où un fonctionnement trompeur en CI
// Linux uniquement). En faire une valeur d'option rend l'ordre indifférent.
step('création de la base de contrôle', 'psql', [
  '-d', SOURCE,
  '-v', 'ON_ERROR_STOP=1',
  '-q',
  '-c', `CREATE DATABASE "${SCRATCH_DB}"`,
])

step('migrations + smoke test sur base vierge', process.execPath, ['scripts/validate-server-db.js'], {
  DATABASE_URL: gateUrl,
  DIRECT_URL: gateUrl,
})

console.log(`✅ migrations serveur rejouées sur une base vierge (${SCRATCH_DB}) + smoke test OK`)

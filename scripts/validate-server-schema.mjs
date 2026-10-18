#!/usr/bin/env node
/**
 * validate-server-schema.mjs — `prisma validate` sur le schéma SERVEUR.
 *
 * Pourquoi un enrobage plutôt qu'un appel direct à `prisma validate` ?
 *
 * `prisma/server/schema.prisma` déclare `directUrl = env("DIRECT_URL")`. Prisma
 * n'applique AUCUN repli : si la variable est absente, la validation — qui est
 * pourtant une vérification purement STATIQUE de la syntaxe et des relations —
 * échoue en P1012 « Environment variable not found: DIRECT_URL ».
 *
 * Or `DIRECT_URL` n'est renseignée que sur un déploiement PostgreSQL réel. Sur
 * un poste de développement propre (et sur tout clone neuf), la commande
 * documentée `npm run db:server:validate` échouait donc systématiquement, sans
 * qu'aucun défaut de schéma n'existe. Un gate qui échoue toujours n'est plus un
 * gate : on apprend à ignorer sa sortie.
 *
 * Cet enrobage fournit une valeur de substitution UNIQUEMENT pour la durée de la
 * validation, et le dit à l'écran. Il ne touche ni `migrate deploy` ni `db push`,
 * qui exigent une vraie URL directe : y substituer l'URL POOLÉE produirait des
 * migrations instables (PgBouncer), c'est-à-dire précisément le défaut que la
 * séparation `url` / `directUrl` existe pour éviter.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolveValidationEnv } from './lib/server-schema-env.mjs'

const { env, substituted } = resolveValidationEnv(process.env)

if (substituted) {
  console.log(
    'ℹ️  DIRECT_URL absente — valeur de substitution utilisée pour cette VALIDATION STATIQUE\n' +
    '   uniquement. Aucune connexion n\'est ouverte. Les migrations serveur\n' +
    '   (`db:server:deploy`, `db:server:migrate`) exigent, elles, une vraie URL directe.',
  )
}

// On lance le CLI Prisma DU PROJET avec le Node courant, plutôt que `npx`.
// Deux raisons, mesurées : sous Windows, `spawnSync('npx.cmd', …)` sans shell
// échoue en EINVAL depuis le durcissement de Node — le processus rendait alors
// un code 1 SANS la moindre sortie, c'est-à-dire un échec de lancement
// indiscernable d'un vrai défaut de schéma. Et résoudre le binaire évite
// d'exécuter une version de Prisma venue du cache npx au lieu de celle du projet.
const require_ = createRequire(import.meta.url)
let cli
try {
  cli = require_.resolve('prisma/build/index.js')
} catch {
  console.error(
    '❌ CLI Prisma introuvable dans node_modules. Lancez `npm ci` avant ce contrôle.',
  )
  process.exit(1)
}

const r = spawnSync(
  process.execPath,
  [cli, 'validate', '--schema', 'prisma/server/schema.prisma'],
  { stdio: 'inherit', env },
)

if (r.error) {
  console.error('❌ Lancement de Prisma impossible :', r.error.message)
  process.exit(1)
}

process.exit(r.status ?? 1)

#!/usr/bin/env node
/**
 * CONTRAT D'ENVIRONNEMENT ⇄ VERCEL — comparaison des NOMS, jamais des valeurs.
 *
 * À exécuter AVANT un déploiement (§43) : vérifie que chaque variable requise en
 * production existe côté Vercel SOUS SON NOM CANONIQUE, et signale les alias
 * historiques encore présents ainsi que les variables inconnues du contrat.
 *
 * Ne vérifie jamais la présence d'une valeur sous un ancien alias : c'est
 * précisément ce qui masquait le défaut avant l'incident du 15/08/2026.
 *
 * Nécessite le CLI Vercel authentifié et un accès réseau — cette garde ne fait
 * donc pas partie de `check:consistency`, qui doit rester hors-ligne.
 *
 * Usage : node scripts/check-env-vercel.mjs [--environnement production]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--environnement')
const ENVIRONNEMENT = i >= 0 ? process.argv[i + 1] : 'production'
// La valeur part dans une commande exécutée via un shell : on la restreint aux
// trois environnements Vercel plutôt que de la faire échapper.
if (!['production', 'preview', 'development'].includes(ENVIRONNEMENT)) {
  console.error(`Environnement invalide : « ${ENVIRONNEMENT} » (attendu production|preview|development)`)
  process.exit(2)
}

const manifeste = JSON.parse(readFileSync(path.join(RACINE, 'scripts', 'garageflow-env-manifest.json'), 'utf8'))
const CANONIQUES = new Map(manifeste.variables.map((v) => [v.name, v]))
const INTERDITS = manifeste.forbiddenAliases ?? {}
const PLATEFORME = new Set(manifeste.platformProvided ?? [])

/** Noms présents chez Vercel. Les VALEURS ne sont ni demandées ni affichées. */
function nomsVercel() {
  let sortie
  try {
    // Sous Windows le CLI est un `.cmd` : sans shell, Node n'applique pas
    // PATHEXT et échoue en ENOENT. La commande est FIXE — l'environnement ne
    // provient d'aucune saisie libre, il est validé juste au-dessus.
    sortie = execFileSync('vercel', ['env', 'ls', ENVIRONNEMENT, '--no-color'], {
      cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true,
    })
  } catch (e) {
    console.error(`Impossible d'interroger Vercel : ${String(e.message ?? e).split('\n')[0]}`)
    console.error('CLI authentifié requis (`vercel login`). Contrôle NON EFFECTUÉ.')
    process.exit(2)
  }
  const noms = new Set()
  for (const ligne of sortie.split(/\r?\n/)) {
    // « NOM   Encrypted   Production   il y a 18h » — le premier jeton suffit.
    const m = ligne.match(/^\s*([A-Z][A-Z0-9_]{2,})\s{2,}\S/)
    if (m) noms.add(m[1])
  }
  return noms
}

const presents = nomsVercel()
if (presents.size === 0) {
  console.error('Aucune variable lue depuis Vercel — format de sortie inattendu. Contrôle NON EFFECTUÉ.')
  process.exit(2)
}

const requises = [...CANONIQUES.values()].filter((v) => v.requiredProduction).map((v) => v.name).sort()
const manquantes = requises.filter((n) => !presents.has(n))
const aliasPresents = [...presents].filter((n) => INTERDITS[n]).sort()
const inconnues = [...presents]
  .filter((n) => !CANONIQUES.has(n) && !PLATEFORME.has(n) && !INTERDITS[n])
  .sort()

console.log(`\n══ ${ENVIRONNEMENT.toUpperCase()} — ${presents.size} variables chez Vercel\n`)
console.log('REQUISES PAR LE CONTRAT')
for (const n of requises) console.log(`   ${presents.has(n) ? 'PRESENT' : 'MANQUANTE'.padEnd(7)}  ${n}`)

if (aliasPresents.length) {
  console.log('\nALIAS HISTORIQUES ENCORE PRÉSENTS (à supprimer)')
  for (const n of aliasPresents) console.log(`   ${n.padEnd(26)} → renommer en ${INTERDITS[n].canonical}`)
}
if (inconnues.length) {
  console.log('\nINCONNUES DU CONTRAT (fournies par une intégration, ou obsolètes)')
  for (const n of inconnues) console.log(`   ${n}`)
}

const echecs = manquantes.length + aliasPresents.length
if (echecs) {
  console.error(
    `\n❌ ${manquantes.length} variable(s) requise(s) manquante(s), ` +
    `${aliasPresents.length} alias historique(s) présent(s).`)
  process.exit(1)
}
console.log(`\n✅ Toutes les variables requises existent sous leur nom canonique ; aucun alias interdit chez Vercel.`)

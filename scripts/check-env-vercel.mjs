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
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--environnement')
const ENVIRONNEMENT = i >= 0 ? process.argv[i + 1] : 'production'

// Le CLI exige un projet : soit le dossier est lie (.vercel/), soit on le nomme.
// Un dossier de travail extrait d'une archive n'est JAMAIS lie — sans cette
// option le controle echouait en annoncant « CLI authentifie requis », ce qui
// designe la mauvaise cause et envoie l'exploitant relancer `vercel login`
// pour rien.
const j = process.argv.indexOf('--projet')
const PROJET = j >= 0 ? process.argv[j + 1] : (process.env.GF_VERCEL_PROJECT || '')
if (j >= 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(PROJET || '')) {
  console.error(`Nom de projet invalide : « ${PROJET} »`)
  process.exit(2)
}
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

/** Sortie brute du CLI, conservee pour distinguer « vide » de « illisible ». */
let SORTIE_BRUTE = ''

/** Noms présents chez Vercel. Les VALEURS ne sont ni demandées ni affichées. */
function nomsVercel() {
  let sortie
  try {
    // Sous Windows le CLI est un `.cmd` : sans shell, Node n'applique pas
    // PATHEXT et échoue en ENOENT. La commande est FIXE — l'environnement ne
    // provient d'aucune saisie libre, il est validé juste au-dessus.
    const args = ['env', 'ls', ENVIRONNEMENT, '--no-color']
    if (PROJET) args.push('--project', PROJET)
    const r = spawnSync('vercel', args, {
      cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true,
    })
    if (r.error) throw r.error
    // Le CLI ecrit son « No Environment Variables found » sur STDERR : ne lire
    // que stdout rendait le cas « aucune variable » indiscernable d'une sortie
    // illisible — c'est-a-dire du defaut le plus grave, rapporte en NON EFFECTUE.
    SORTIE_BRUTE = `${r.stdout ?? ''}
${r.stderr ?? ''}`
    if (r.status !== 0) {
      const err = new Error(`Command failed: vercel ${args.join(' ')}`)
      err.stdout = r.stdout
      err.stderr = r.stderr
      throw err
    }
    sortie = r.stdout ?? ''
  } catch (e) {
    console.error(`Impossible d'interroger Vercel : ${String(e.message ?? e).split('\n')[0]}`)
    // Trois causes DISTINCTES, trois diagnostics distincts : les confondre fait
    // suivre le mauvais correctif.
    const brut = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? e}`
    if (/isn.t linked|not linked|No project linked|--project/i.test(brut)) {
      console.error('Cause : ce dossier n’est lié à AUCUN projet Vercel (copie extraite d’une archive).')
      console.error('Correctif : relancer avec `--projet <nom>` (ou définir GF_VERCEL_PROJECT), par exemple :')
      console.error('            node scripts/check-env-vercel.mjs --projet app.garageflows.fr')
    } else if (/credentials|not authenticated|log ?in|token/i.test(brut)) {
      console.error('Cause : CLI non authentifié. Correctif : `vercel login`.')
    } else {
      console.error('Cause indéterminée — vérifier le réseau et les droits sur l’équipe.')
    }
    console.error('Contrôle NON EFFECTUÉ.')
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
// Un projet qui ne declare REELLEMENT aucune variable est le pire cas possible,
// et c'est precisement celui que ce controle traitait en « format de sortie
// inattendu » (exit 2, NON EFFECTUE) : le defaut le plus grave etait le seul que
// le controle ne savait pas rapporter. Le CLI dit explicitement « No Environment
// Variables found » — on le distingue d'une sortie illisible.
if (presents.size === 0) {
  if (/No Environment Variables found/i.test(SORTIE_BRUTE)) {
    const toutes = [...CANONIQUES.values()].filter((v) => v.requiredProduction).map((v) => v.name).sort()
    console.error(`\n❌ ${ENVIRONNEMENT.toUpperCase()} — le projet Vercel ne déclare AUCUNE variable d’environnement.`)
    console.error(`   Les ${toutes.length} variable(s) requise(s) par le contrat sont donc TOUTES absentes :`)
    for (const n of toutes) console.error(`     MANQUANTE  ${n}`)
    console.error('\n   Un déploiement EN COURS peut continuer de fonctionner avec les variables qui lui')
    console.error('   étaient attachées à sa création : une application en ligne ne prouve donc RIEN')
    console.error('   sur cette configuration. Le prochain déploiement, lui, n’aura aucune de ces valeurs.')
    console.error('   La configuration de production n’est pas reproductible.')
    process.exit(1)
  }
  console.error('Aucune variable lue alors que la sortie n’est pas « No Environment Variables found » :')
  console.error('format inattendu (le CLI a peut-être changé). Contrôle NON EFFECTUÉ.')
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

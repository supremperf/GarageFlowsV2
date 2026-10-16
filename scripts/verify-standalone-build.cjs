#!/usr/bin/env node
'use strict'

/**
 * Vérifie que la sortie `standalone` de Next.js est VRAIMENT empaquetable.
 *
 * ─── Pourquoi cette étape existe ─────────────────────────────────────────────
 *
 * `next build` peut réussir et produire un dossier `standalone` incomplet :
 *
 *   • sortie IMBRIQUÉE (`.next/standalone/Desktop/MonProjet/server.js`) quand
 *     Next.js a déduit une autre racine de workspace — l'ancien message
 *     « server.js NOT found » de `post-build.js` venait de là, alors que la
 *     compilation, elle, s'était parfaitement déroulée ;
 *   • fichiers statiques absents (`.next/static`, `public/`) : l'application
 *     démarre, puis sert des pages sans style ni image ;
 *   • dépendances d'exécution manquantes (`next`, `react`, `@prisma/client`),
 *     que le serveur autonome ne peut pas résoudre à chaud ;
 *   • moteur Prisma absent (`node_modules/.prisma/client`) : la première
 *     requête à la base échoue, sur le poste du garage, après l'installation.
 *
 * Ces pannes ne se voient pas au build : elles se voient chez le client. Ce
 * script les rend visibles AVANT l'empaquetage, avec la cause et le correctif.
 *
 * Sortie : 0 si la sortie est complète, 1 sinon (avec la liste des manques).
 */

const fs = require('node:fs')
const path = require('node:path')
const { inspectStandaloneLayout, modulesExecutionManquants } = require('./lib/standalone-layout.cjs')

/**
 * Racine analysée : le dépôt par défaut (usage `npm run verify:standalone`), ou
 * le dossier passé en argument. L'argument n'existe que pour rendre ce garde-fou
 * VÉRIFIABLE par les tests sur des arborescences synthétiques (sortie saine,
 * sortie absente, sortie incomplète) : la CI, elle, ne passe aucun argument.
 */
const RACINE = (() => {
  const argument = process.argv[2]
  if (!argument || argument.startsWith('--')) return path.resolve(__dirname, '..')
  return path.resolve(argument)
})()
const STANDALONE = path.join(RACINE, '.next', 'standalone')

/** Fichiers/dossiers indispensables, relatifs au dossier de l'application. */
const REQUIS = [
  ['server.js',                                   'point d’entrée du serveur autonome'],
  ['.next/static',                                'ressources statiques (JS/CSS) construites'],
  ['public',                                      'fichiers publics (icônes, images, manifeste)'],
  ['package.json',                                'manifeste du projet copié dans la sortie'],
]

const PROBLEMES = []
const OK = []

/**
 * Un dossier contient-il au moins un fichier (à n'importe quelle profondeur) ?
 *
 * On ne peut PAS se fier à `statSync(dir).size` : sur Windows, la taille d'un
 * dossier vaut **toujours 0** — `.next/static` et `public/`, copiés avec
 * respectivement 242 et 10 fichiers, étaient déclarés « vide » sur l'exécuteur
 * Windows (run 38954955756) et bloquaient l'empaquetage d'une sortie saine.
 */
function dossierNonVide(dir, profondeur = 0) {
  if (profondeur > 8) return true
  let entrees
  try { entrees = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const entree of entrees) {
    if (entree.isFile()) return true
    if (entree.isDirectory() && dossierNonVide(path.join(dir, entree.name), profondeur + 1)) return true
  }
  return false
}

function verifierFichier(chemin, description) {
  if (!fs.existsSync(chemin)) {
    PROBLEMES.push(`${description} manquant : ${path.relative(RACINE, chemin)}`)
    return false
  }
  try {
    const stat = fs.statSync(chemin)
    const vide = stat.isDirectory() ? !dossierNonVide(chemin) : stat.size === 0
    if (vide) {
      PROBLEMES.push(`${description} vide : ${path.relative(RACINE, chemin)}`)
      return false
    }
  } catch (err) {
    PROBLEMES.push(`lecture impossible (${description}) : ${err.message}`)
    return false
  }
  OK.push(description)
  return true
}

function main() {
  // ⚠️ `inspectStandaloneLayout` attend la RACINE DU PROJET et ajoute lui-même
  // `.next/standalone`. Lui passer `STANDALONE` construisait
  // `.next/standalone/.next/standalone` : le contrôle échouait TOUJOURS, y compris
  // sur une sortie parfaitement saine, avec le message « dossier absent » —
  // exactement ce qui est arrivé sur l'exécuteur Windows (run 38953330502), APRÈS
  // que le post-build ait copié `server.js`, les ressources statiques et `public`
  // au bon endroit. Un faux rouge qui bloque un installeur valide.
  const layout = inspectStandaloneLayout(RACINE)

  if (!layout.ok) {
    console.error('')
    console.error('❌ Sortie autonome Next.js inutilisable pour l’empaquetage.')
    console.error(`   ${layout.error}`)
    console.error('')
    console.error('   Cause la plus fréquente : une racine de workspace différente de celle du')
    console.error('   projet (un package-lock.json dans le dossier utilisateur suffit à Next.js pour')
    console.error('   l’adopter) décale toute la sortie d’un niveau.')
    console.error('   Correctif : garder `outputFileTracingRoot` dans next.config.mjs, puis')
    console.error('              supprimer .next et relancer `npm run build`.')
    console.error('')
    process.exit(1)
  }

  const appDir = layout.appDir
  const standaloneRel = path.relative(RACINE, STANDALONE) || '.next/standalone'
  const appRel = path.relative(RACINE, appDir) || standaloneRel

  console.log(`🔎 Sortie autonome : ${appRel}`)
  if (layout.nested) {
    console.log(`   (imbriquée sous ${path.relative(appDir, STANDALONE) || '.'} — tolérée, voir postbuild)`)
  }

  for (const [rel, description] of REQUIS) {
    verifierFichier(path.join(appDir, rel), description)
  }

  // Le serveur doit être un vrai fichier, pas un jumeau vide (copie interrompue).
  const serverPath = path.join(appDir, 'server.js')
  if (fs.existsSync(serverPath)) {
    const contenu = fs.readFileSync(serverPath, 'utf8')
    if (contenu.length < 1000 || !contenu.includes('next')) {
      PROBLEMES.push('server.js trop court ou inattendu : la compilation n’a pas abouti')
    }
  }

  // Les ressources statiques doivent être RÉELLEMENT présentes (un dossier vide
  // suffit à faire démarrer l’application avec des pages sans style).
  const chunks = path.join(appDir, '.next', 'static', 'chunks')
  if (fs.existsSync(path.join(appDir, '.next', 'static')) && !fs.existsSync(chunks)) {
    PROBLEMES.push('aucun fichier dans .next/static/chunks : le client ne recevra aucun script')
  }

  // Chemins relatifs au dossier d'application, fournis par la lib : composés ici
  // une seule fois (l'ancien code préfixait `node_modules/` à une entrée qui le
  // contenait déjà et signalait un manque inexistant).
  for (const moduleRel of modulesExecutionManquants(appDir)) {
    PROBLEMES.push(moduleRel.startsWith('(ni copié, ni embarqué)')
      ? `module d’exécution absent de la sortie — ${moduleRel}`
      : `module d’exécution absent de la sortie : ${moduleRel}`)
  }

  // Clé publique de vérification des mises à jour : sans elle, la copie n’est
  // pas signable/vérifiable et `afterPack` échoue plus loin.
  if (!fs.existsSync(path.join(appDir, 'keys', 'public.pem')) && !fs.existsSync(path.join(RACINE, 'keys', 'public.pem'))) {
    PROBLEMES.push('keys/public.pem introuvable (nécessaire à la vérification des mises à jour)')
  }

  // Coquilles qui feraient échouer Prisma au premier accès.
  if (!fs.existsSync(path.join(appDir, 'prisma', 'schema.prisma'))) {
    PROBLEMES.push('prisma/schema.prisma absent de la sortie : Prisma ne pourra pas se localiser')
  }
  if (!fs.existsSync(path.join(appDir, 'node_modules', '.prisma', 'client'))) {
    PROBLEMES.push('moteur Prisma absent : lancez `npx prisma generate` avant `npm run build`')
  }

  if (PROBLEMES.length) {
    console.error('')
    console.error(`❌ Sortie autonome incomplète (${PROBLEMES.length} problème(s)) :`)
    for (const p of PROBLEMES) console.error(`   • ${p}`)
    console.error('')
    console.error('   Correctif : supprimer .next puis relancer `npm run build`.')
    console.error('')
    process.exit(1)
  }

  console.log(`✅ Sortie autonome complète (${OK.length} éléments vérifiés) — prête à être empaquetée.`)
  console.log('   Étape suivante : `npm run dist` (installeur Windows).')
}

main()

module.exports = { REQUIS }

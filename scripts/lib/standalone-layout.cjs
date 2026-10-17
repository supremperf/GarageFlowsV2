'use strict'
/**
 * Résolution de la mise en page de `.next/standalone` — PUR (aucune écriture).
 *
 * ─── Pourquoi ce module existe ──────────────────────────────────────────────
 * `scripts/post-build.js` copiait `.next/static`, `public/`, `keys/public.pem`
 * et les ressources Prisma vers des chemins FIXES sous `.next/standalone/`. Ce
 * raisonnement n'est valide que si Next.js a bien écrit `server.js` À LA RACINE
 * du dossier standalone.
 *
 * Or Next.js place le standalone sous la « racine de workspace » qu'il infère :
 * en présence d'un `package-lock.json` parasite dans un dossier PARENT du dépôt
 * (cas courant : `C:\Users\<nom>\package-lock.json` après un `npm install` lancé
 * hors projet), l'application se retrouvait dans
 * `.next/standalone/Desktop/GarageFlowsV2-<branche>/` et le script échouait sur
 * « server.js NOT found » — un message trompeur, puisque c'est le CHEMIN qui
 * était faux, pas la compilation.
 *
 * `next.config.mjs` corrige la racine (`outputFileTracingRoot`). Ce module
 * garantit en plus que la chaîne de build reste diagnostiquable et sûre :
 *   • elle LOCALISE réellement `server.js` (racine, puis imbrication) ;
 *   • elle refuse de continuer si la sortie est imbriquée, en expliquant la
 *     cause exacte et le correctif — jamais un « server.js NOT found » sec ;
 *   • les copies se font DANS le dossier qui contient réellement `server.js`,
 *     pas dans un chemin supposé.
 */

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

/** Profondeur maximale explorée : une imbrication de workspace reste faible. */
const MAX_DEPTH = 6

/** Dossiers jamais explorés (volumineux et sans rapport avec server.js). */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'cache', 'dist'])

/**
 * Cherche `server.js` dans un dossier, y compris dans d'éventuels
 * sous-dossiers d'imbrication (`Desktop/MonProjet/server.js`).
 *
 * @param {string} standaloneDir dossier `.next/standalone`
 * @returns {{ serverJs: string|null, nested: string|null, depth: number }}
 *   `nested` = chemin RELATIF de l'imbrication ('' si server.js est à la racine),
 *   `null` si aucun server.js n'a été trouvé.
 */
function findServerJs(standaloneDir) {
  const direct = path.join(standaloneDir, 'server.js')
  if (isFile(direct)) return { serverJs: direct, nested: '', depth: 0 }

  const found = []
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORED_DIRS.has(entry.name) || entry.name === '.next') continue
      const child = path.join(dir, entry.name)
      if (isFile(path.join(child, 'server.js'))) {
        found.push(path.join(child, 'server.js'))
        continue // On ne descend pas plus loin : premier niveau d'imbrication utile.
      }
      walk(child, depth + 1)
    }
  }
  walk(standaloneDir, 1)

  if (found.length === 0) return { serverJs: null, nested: null, depth: 0 }
  // Déterministe : le chemin le plus court, puis l'ordre alphabétique.
  found.sort((a, b) => a.length - b.length || a.localeCompare(b))
  const serverJs = found[0]
  return {
    serverJs,
    nested: path.relative(standaloneDir, path.dirname(serverJs)).split(path.sep).join('/'),
    depth: path.relative(standaloneDir, path.dirname(serverJs)).split(path.sep).length,
  }
}

function isFile(file) {
  try { return fs.statSync(file).isFile() } catch { return false }
}

/**
 * Analyse complète de la sortie standalone.
 *
 * @param {string} root dossier du projet
 * @returns {{
 *   standaloneDir: string, serverJs: string|null, appDir: string|null,
 *   nested: string|null, exists: boolean, ok: boolean, error: string|null,
 *   staticDir: string|null, publicDir: string|null, staticCopied: boolean
 * }}
 */
function inspectStandaloneLayout(root) {
  const standaloneDir = path.join(root, '.next', 'standalone')
  const appDir = path.join(standaloneDir, '.next')
  const result = {
    standaloneDir,
    serverJs: null,
    appDir: null,
    nested: null,
    exists: fs.existsSync(standaloneDir),
    ok: false,
    error: null,
    staticDir: null,
    publicDir: null,
    staticCopied: false,
  }

  if (!result.exists) {
    result.error = `Dossier .next/standalone absent : la compilation Next.js n'a pas produit de sortie autonome (output: 'standalone').`
    return result
  }

  const found = findServerJs(standaloneDir)
  if (!found.serverJs) {
    result.error = "server.js introuvable dans .next/standalone (même en profondeur). La compilation est incomplète : ne pas empaqueter cette sortie."
    return result
  }

  result.serverJs = found.serverJs
  result.appDir = path.dirname(found.serverJs)
  result.nested = found.nested
  result.staticDir = path.join(result.appDir, '.next', 'static')
  result.publicDir = path.join(result.appDir, 'public')
  result.staticCopied = fs.existsSync(result.staticDir)

  if (found.nested) {
    // Sortie imbriquée : le dossier empaqueté ne serait pas lançable. On REFUSE,
    // avec la cause et le correctif, au lieu d'un échec obscur plus loin.
    result.error =
      `Sortie standalone IMBRIQUÉE dans « ${found.nested}/ » : ` +
      `.next/standalone/server.js est attendu à la racine. ` +
      `Cause : Next.js a inféré la racine de workspace à partir d'un lockfile situé dans un dossier PARENT du dépôt ` +
      `(par ex. C:\\Users\\<nom>\\package-lock.json). ` +
      `Correctif : conserver outputFileTracingRoot: <dossier du projet> dans next.config.mjs ` +
      `(déjà présent dans ce dépôt) et nettoyer .next/ avant de reconstruire.`
    return result
  }

  result.ok = true
  return result
}

/**
 * Dossier qui contient RÉELLEMENT `server.js` — destination des ressources
 * statiques, de `public/` et des clés publiques. En sortie saine c'est
 * `.next/standalone` ; si une imbrication apparaît, on écrit au bon endroit.
 */
/**
 * Modules que le serveur autonome importe RÉELLEMENT au démarrage, exprimés en
 * chemins relatifs au dossier d'application (`appDir`). Source unique, partagée
 * par `verify-standalone-build.cjs`, pour éviter les chemins composés deux fois
 * (« node_modules/node_modules/… ») qui déclaraient un manque inexistant et
 * bloquaient un installeur pourtant valide.
 */
const MODULES_EXECUTION = [
  'node_modules/next/package.json',
  'node_modules/react/package.json',
  'node_modules/react-dom/package.json',
  'node_modules/@prisma/client/package.json',
  'node_modules/.prisma/client/index.js',
]

/*
 * `next-auth` n'est PAS dans cette liste, et ce n'est pas un oubli.
 *
 * Mesure : une vraie compilation `next build` (sortie autonome réelle) place
 * `next`, `react`, `react-dom`, `@prisma/client` dans `.next/standalone/node_modules`
 * — ce sont des dépendances externées — mais **`node_modules/next-auth` n'existe
 * pas** : `next-auth` est importé par les routes serveur (`getServerSession`,
 * `NextAuth`) et, n'étant pas déclaré dans `serverExternalPackages`, il est
 * EMBARQUÉ dans les morceaux compilés par webpack. L'exiger comme fichier
 * présent faisait échouer la vérification sur une sortie parfaitement saine
 * (observé sur l'exécuteur Windows, run 38954955756).
 */

/**
 * Modules que la compilation EMBARQUE dans ses propres morceaux au lieu de les
 * copier : ils n'apparaissent jamais dans `node_modules/` de la sortie, mais leur
 * code doit bel et bien être présent. On les reconnaît à une chaîne d'exécution
 * que la minification ne peut pas retirer (un nom de cookie, un message d'erreur).
 *
 * Mesure à l'appui : une vraie sortie autonome ne contient pas
 * `node_modules/next-auth`, et `.next/server/chunks/8858.js` contient
 * `next-auth.session-token`. Exiger le module physique faisait échouer la
 * vérification sur une sortie saine (exécuteur Windows, run 38954955756).
 */
const MODULES_EMBARQUES = [
  { nom: 'next-auth', marqueur: 'next-auth.session-token' },
]

/** Le marqueur apparaît-il dans les morceaux serveur compilés ? */
function marqueurEmbarque(appDir, marqueur, profondeur = 0) {
  const racine = path.join(appDir, '.next', 'server')
  if (!fs.existsSync(racine)) return false
  const parcourir = (dir, niveau) => {
    if (niveau > 5) return false
    let entrees
    try { entrees = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
    for (const entree of entrees) {
      const chemin = path.join(dir, entree.name)
      if (entree.isDirectory()) {
        if (parcourir(chemin, niveau + 1)) return true
      } else if (entree.name.endsWith('.js')) {
        try {
          if (fs.statSync(chemin).size > 20 * 1024 * 1024) continue
          if (fs.readFileSync(chemin, 'utf8').includes(marqueur)) return true
        } catch { /* fichier illisible : on continue, la décision se prend plus loin */ }
      }
    }
    return false
  }
  return parcourir(racine, 0)
}

/**
 * Vérifie que Node résout réellement le module depuis server.js ET que la
 * résolution reste dans le dossier autonome. `existsSync(node_modules/next)`
 * suit les liens symboliques : il pouvait donc annoncer « présent » alors que
 * electron-builder n'embarquait pas la cible située hors de standalone.
 * @param {string} appDir dossier contenant `server.js`
 * @param {string} moduleName nom du module à résoudre
 * @returns {string|null} diagnostic si le runtime ne sera pas autonome
 */
function problemeResolutionRuntime(appDir, moduleName = 'next') {
  const serverJs = path.join(appDir, 'server.js')
  const packageDir = path.join(appDir, 'node_modules', moduleName)
  if (!fs.existsSync(serverJs) || !fs.existsSync(path.join(packageDir, 'package.json'))) return null

  let resolved
  try {
    resolved = createRequire(serverJs).resolve(moduleName)
  } catch (error) {
    return `${moduleName} non résolu depuis server.js (${error.code || error.message})`
  }

  const relatif = path.relative(packageDir, resolved)
  if (relatif === '..' || relatif.startsWith(`..${path.sep}`) || path.isAbsolute(relatif)) {
    return `${moduleName} résolu hors du standalone (${resolved})`
  }
  return null
}

/**
 * Modules d'exécution absents de la sortie autonome — ni copiés, ni embarqués.
 * @param {string} appDir dossier contenant `server.js`
 * @returns {string[]} chemins relatifs manquants (vide si la sortie est complète)
 */
function modulesExecutionManquants(appDir) {
  const manquants = MODULES_EXECUTION.filter((relatif) => !fs.existsSync(path.join(appDir, relatif)))
  const resolutionNext = problemeResolutionRuntime(appDir)
  if (resolutionNext) manquants.push(resolutionNext)
  for (const { nom, marqueur } of MODULES_EMBARQUES) {
    const physique = fs.existsSync(path.join(appDir, 'node_modules', nom, 'package.json'))
    if (!physique && !marqueurEmbarque(appDir, marqueur)) manquants.push(`(ni copié, ni embarqué) ${nom}`)
  }
  return manquants
}

function standaloneAppDir(standaloneDir) {
  const found = findServerJs(standaloneDir)
  return found.serverJs ? path.dirname(found.serverJs) : standaloneDir
}

/**
 * Répertoires de `standaloneDir` qui contiennent EUX-MÊMES un `server.js` alors
 * que ce n'est pas le dossier d'application retenu : ce sont des copies
 * périmées de l'application, écrites lors d'un build antérieur où Next.js avait
 * inféré une autre racine de workspace. Les laisser dans l'artefact revient à
 * embarquer une seconde application (avec ses ressources, et parfois son `.env`
 * d'époque) dans chaque installateur. On les liste ici pour que le post-build
 * les supprime explicitement.
 *
 * @param {string} standaloneDir
 * @param {string} appDir dossier d'application retenu (jamais supprimé)
 * @returns {string[]} chemins absolus des copies périmées
 */
function staleAppDirs(standaloneDir, appDir) {
  const trouvees = new Set()
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
      const child = path.join(dir, entry.name)
      if (child === appDir) continue
      if (isFile(path.join(child, 'server.js'))) { trouvees.add(child); continue }
      walk(child, depth + 1)
    }
  }
  walk(standaloneDir, 1)
  return [...trouvees]
}

module.exports = { MAX_DEPTH, IGNORED_DIRS, MODULES_EXECUTION, MODULES_EMBARQUES, marqueurEmbarque, problemeResolutionRuntime, modulesExecutionManquants, findServerJs, inspectStandaloneLayout, standaloneAppDir, staleAppDirs }

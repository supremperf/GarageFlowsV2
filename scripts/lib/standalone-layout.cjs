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

module.exports = { MAX_DEPTH, IGNORED_DIRS, findServerJs, inspectStandaloneLayout, standaloneAppDir, staleAppDirs }

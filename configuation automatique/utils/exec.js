'use strict'
/**
 * Exécution de programmes externes (CLI fournisseurs) sans fuite de secret.
 *
 * Trois règles structurent ce module :
 *  1. JAMAIS de shell. Un identifiant, un chemin ou un identifiant de projet qui
 *     deviendrait une commande shell est une exécution de code arbitraire. Les
 *     arguments partent en argv, un par un.
 *  2. JAMAIS de secret en argument. Sous Windows comme sous Linux, la ligne de
 *     commande d'un processus est lisible par d'autres processus du même
 *     utilisateur (`Get-CimInstance Win32_Process`). Les valeurs sensibles
 *     passent donc par l'entrée standard ou par un fichier privé temporaire.
 *  3. JAMAIS de sortie fournisseur propagée telle quelle. `stderr` d'un CLI peut
 *     contenir une URL signée ou un en-tête d'authentification. On n'en extrait
 *     que des informations bornées et on jette le reste.
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const DELAI_DEFAUT_MS = 120000

/** Chemin du script npm-cli.js, pour lancer npm sans dépendre du PATH ni d'un shell. */
function npmCli() {
  const candidats = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ]
  const trouve = candidats.find((candidat) => candidat && /npm-cli\.js$/.test(candidat) && fs.existsSync(candidat))
  if (!trouve) throw new Error('npm introuvable : Node.js 22 avec npm est requis.')
  return trouve
}

/**
 * Lance un programme et rend sa sortie standard.
 *
 * @param {string} programme chemin ou nom du binaire (jamais interprété par un shell)
 * @param {string[]} args arguments, un par élément
 * @param {{ cwd?: string, env?: object, input?: string, delaiMs?: number,
 *           libelle?: string, captureStderr?: boolean }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function lancer(programme, args, options = {}) {
  const { cwd, env = process.env, input, delaiMs = DELAI_DEFAUT_MS, libelle = 'Commande', captureStderr = false } = options
  return new Promise((resolve, reject) => {
    let enfant
    try {
      enfant = spawn(programme, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true })
    } catch {
      reject(new Error(libelle + ' : lancement impossible.'))
      return
    }
    let stdout = ''
    let stderr = ''
    let termine = false
    const minuterie = setTimeout(() => {
      if (termine) return
      termine = true
      try { enfant.kill('SIGKILL') } catch { /* déjà terminé */ }
      reject(Object.assign(new Error(libelle + ' : délai dépassé (' + delaiMs + ' ms).'), { expire: true }))
    }, delaiMs)
    minuterie.unref?.()

    enfant.stdout.setEncoding('utf8')
    // Bornes dures : une sortie anormalement longue ne doit pas saturer la mémoire
    // du configurateur ni se retrouver entière dans un rapport.
    enfant.stdout.on('data', (morceau) => { stdout = (stdout + morceau).slice(-4194304) })
    if (captureStderr) {
      enfant.stderr.setEncoding('utf8')
      enfant.stderr.on('data', (morceau) => { stderr = (stderr + morceau).slice(-65536) })
    } else enfant.stderr.resume()

    enfant.stdin.on('error', () => { /* le programme peut fermer son entrée avant nous */ })
    enfant.stdin.end(input === undefined ? undefined : input)

    enfant.once('error', () => {
      if (termine) return
      termine = true
      clearTimeout(minuterie)
      reject(Object.assign(new Error(libelle + ' : programme introuvable ou non exécutable.'), { introuvable: true }))
    })
    enfant.once('close', (code) => {
      if (termine) return
      termine = true
      clearTimeout(minuterie)
      resolve({ code: code === null ? -1 : code, stdout, stderr })
    })
  })
}

/**
 * Comme `lancer`, mais rejette sur un code de sortie non nul.
 * L'erreur ne porte jamais la sortie du fournisseur, seulement son code.
 */
async function lancerStrict(programme, args, options = {}) {
  const resultat = await lancer(programme, args, { ...options, captureStderr: true })
  if (resultat.code !== 0) {
    const erreur = new Error((options.libelle || 'Commande') + ' : échec (code ' + resultat.code + ').')
    erreur.code = resultat.code
    erreur.stdout = resultat.stdout
    erreur.stderr = resultat.stderr
    throw erreur
  }
  return resultat
}

/**
 * Détecte la présence d'un exécutable sans rien exécuter d'autre que sa version.
 * @returns {Promise<{ present: boolean, version: string|null }>}
 */
async function version(programme, args = ['--version'], motif = /(\d+\.\d+\.\d+)/) {
  try {
    const resultat = await lancer(programme, args, { delaiMs: 60000, captureStderr: true, libelle: programme })
    const texte = resultat.stdout + '\n' + resultat.stderr
    const trouve = texte.match(motif)
    return { present: resultat.code === 0, version: trouve ? trouve[1] : null }
  } catch {
    return { present: false, version: null }
  }
}

module.exports = { lancer, lancerStrict, version, npmCli, DELAI_DEFAUT_MS }

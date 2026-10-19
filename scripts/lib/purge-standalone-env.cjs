/**
 * Retrait des `.env` de la sortie `standalone` — GF31-AUD-068.
 *
 * Next.js (`output: 'standalone'`) TRACE le `.env` du dépôt dans sa sortie, et
 * `package.json` → `build.extraFiles` recopie **tout** `.next/standalone` dans
 * l'application empaquetée. Un `.env` laissé là part donc en clair dans chaque
 * installateur, lisible sous `resources/standalone/.env`. C'est arrivé.
 *
 * `post-build.js` purge ce répertoire depuis toujours ; la porte de release, qui
 * construit **sans** appeler `post-build`, ne le faisait pas — elle laissait
 * derrière elle l'état exact que son propre contrôle `verify-artifact` refuse au
 * passage suivant. Deux exécutions consécutives suffisaient à obtenir un rouge
 * intitulé « Fuite de secrets », sans la moindre fuite.
 *
 * D'où ce module : une seule implémentation, deux appelants. En CommonJS
 * explicite pour être requis aussi bien depuis `post-build.js` (CJS) que depuis
 * la porte (`.mjs`, via `createRequire`), sans dépendre du support `require(esm)`
 * d'une version de Node donnée.
 */
const fs = require('fs')
const path = require('path')

/**
 * @param {string} standaloneDir  chemin de `.next/standalone`
 * @returns {string[]} noms des fichiers retirés (vide si rien, ou si absent)
 */
function purgerEnvStandalone(standaloneDir) {
  let entrees
  try {
    entrees = fs.readdirSync(standaloneDir)
  } catch {
    return [] // pas de build : rien à purger, et ce n'est pas une anomalie
  }
  const retires = []
  for (const nom of entrees) {
    if (nom === '.env' || nom.startsWith('.env.')) {
      fs.rmSync(path.join(standaloneDir, nom), { force: true })
      retires.push(nom)
    }
  }
  return retires
}

module.exports = { purgerEnvStandalone }

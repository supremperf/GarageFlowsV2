'use strict'
/**
 * FOURNISSEUR UPSTASH (Redis REST).
 *
 * Le limiteur de débit de GarageFlows est *fail-closed* en production PWA :
 * quand Upstash ne répond pas, la connexion et l'activation de licence sont
 * REFUSÉES (`src/lib/security/rate-limit.ts`). Un contrôle de format est donc
 * insuffisant ici — c'est précisément la panne que l'on cherche à exclure. On
 * envoie un `PING` réel et on exige `PONG`.
 *
 * La sonde réutilise `scripts/config-services.cjs#testRedis`, qui refuse déjà
 * les redirections et les URL porteuses d'identifiants : un jeton Redis ne doit
 * jamais suivre une redirection vers un autre serveur.
 */

const path = require('node:path')

const exec = require('../utils/exec.js')
const redact = require('../security/redact.js')

/** Contrôle de forme : endpoint REST HTTPS Upstash, sans identifiants intégrés. */
function controlerForme(valeurs) {
  const problemes = []
  const url = valeurs.UPSTASH_REDIS_REST_URL
  const jeton = valeurs.UPSTASH_REDIS_REST_TOKEN
  if (!url) problemes.push('UPSTASH_REDIS_REST_URL : absente.')
  if (!jeton) problemes.push('UPSTASH_REDIS_REST_TOKEN : absent.')
  if (url) {
    try {
      const analysee = new URL(String(url).trim())
      if (analysee.protocol !== 'https:') problemes.push('UPSTASH_REDIS_REST_URL : l API REST est en https (une URL rediss:// ferait échouer chaque appel).')
      if (analysee.username || analysee.password) problemes.push('UPSTASH_REDIS_REST_URL : aucun identifiant ne doit figurer dans l URL.')
      if (analysee.search || analysee.hash) problemes.push('UPSTASH_REDIS_REST_URL : ni paramètre ni fragment attendu.')
      if (!/\.upstash\.io$/i.test(analysee.hostname)) problemes.push('UPSTASH_REDIS_REST_URL : hôte .upstash.io attendu ; le jeton ne doit pas partir vers un autre domaine.')
    } catch {
      problemes.push('UPSTASH_REDIS_REST_URL : URL illisible.')
    }
  }
  return problemes
}

/**
 * Envoie un PING réel.
 * @returns {{ forme: string[], joignable: boolean, latenceMs: number|null, erreur: string|null }}
 */
async function sonder(racine, valeurs, options = {}) {
  const resultat = { forme: controlerForme(valeurs), joignable: false, latenceMs: null, erreur: null, hote: null }
  if (resultat.forme.length) {
    resultat.erreur = 'Configuration Redis incomplète ou invalide : aucune requête envoyée.'
    return resultat
  }
  try {
    resultat.hote = new URL(valeurs.UPSTASH_REDIS_REST_URL).hostname
  } catch { /* la forme a déjà été contrôlée */ }

  const services = require(path.join(racine, 'scripts/config-services.cjs'))
  const debut = Date.now()
  try {
    await services.testRedis(valeurs, options.fetch || fetch)
    resultat.joignable = true
    resultat.latenceMs = Date.now() - debut
  } catch (erreur) {
    resultat.latenceMs = Date.now() - debut
    resultat.erreur = redact.nettoyer(erreur.message).slice(0, 200)
  }
  return resultat
}

/**
 * Inventaire Upstash : seulement si le CLI est présent dans le cache local et
 * authentifié. Jamais de création de base ici — une base Redis supplémentaire
 * engage un quota et une facturation.
 */
async function inventaire(racine, options = {}) {
  const etat = { cli: false, authentifie: false, bases: [], erreur: null }
  const npm = exec.npmCli()
  let sortie
  try {
    sortie = await exec.lancer(process.execPath,
      [npm, 'exec', '--no', '--package=upstash@1.5.0', '--', 'upstash', 'redis', 'list'],
      { cwd: racine, delaiMs: options.delaiMs || 120000, captureStderr: true, libelle: 'upstash' })
  } catch {
    etat.erreur = 'CLI upstash indisponible localement : inventaire non effectué.'
    return etat
  }
  etat.cli = true
  if (sortie.code !== 0) {
    etat.erreur = 'CLI upstash présent mais non authentifié : aucune base listée, aucune création.'
    return etat
  }
  try {
    const donnees = JSON.parse(sortie.stdout)
    if (!Array.isArray(donnees)) throw new Error()
    etat.authentifie = true
    etat.bases = donnees
      .filter((base) => base && typeof base.endpoint === 'string')
      .map((base) => ({ id: base.database_id, nom: base.database_name, endpoint: base.endpoint, region: base.region || null }))
  } catch {
    etat.erreur = 'CLI upstash : format de sortie inattendu, aucune valeur importée.'
  }
  return etat
}

module.exports = { controlerForme, sonder, inventaire }

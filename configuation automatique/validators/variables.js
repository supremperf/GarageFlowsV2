'use strict'
/**
 * VALIDATION DES VALEURS.
 *
 * La validation de référence est celle du dépôt : `config-core.validate()`.
 * C'est elle que l'assistant interactif applique, et c'est elle qui encode les
 * règles réellement attendues par l'application (couple poolée/directe sur la
 * même branche, clés AES de 32 octets, bornes du délai Upstash, refus des
 * identifiants connus exposés…). La réécrire créerait deux vérités.
 *
 * Ce module l'appelle avec le bon profil, puis ajoute ce qu'elle ne couvre pas :
 *   · le profil « cible Vercel » n'est pas le profil « poste » — `TRUST_PROXY_HEADERS`
 *     est exigé hors Vercel et interdit d'être deviné sur Vercel ;
 *   · les valeurs présentes mais vides, que la validation ignore alors qu'elles
 *     signalent une configuration interrompue.
 */

const path = require('node:path')

/** Profil `config-core` correspondant à une cible du configurateur. */
function profilPour(cible) {
  return cible === 'desktop' ? 'desktop' : 'pwa'
}

/**
 * Valide un jeu de valeurs pour une cible.
 *
 * @param {string} racine
 * @param {object} valeurs
 * @param {string} cible 'desktop' | 'development' | 'preview' | 'production'
 * @param {{ jetonsBlobAutorises?: Set<string> }} options
 * @returns {{ erreurs: string[], vides: string[], profil: string }}
 */
function valider(racine, valeurs, cible, options = {}) {
  const noyau = require(path.join(racine, 'scripts/config-core.cjs'))
  const profil = profilPour(cible)
  const surVercel = cible !== 'desktop'

  // La clé publique embarquée sert à vérifier GF_PRIVATE_KEY : sans elle,
  // `validate` refuserait toute clé privée, y compris la bonne.
  let clePublique
  try {
    clePublique = noyau.embeddedLicenseKey(racine)
  } catch {
    clePublique = undefined
  }

  const vides = Object.keys(valeurs).filter((nom) => valeurs[nom] !== undefined && String(valeurs[nom]).trim() === '')
  // `validate` ignore les valeurs vides ; on les retire pour éviter un faux
  // négatif sur un format, tout en les signalant séparément.
  const renseignees = {}
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (valeur !== undefined && String(valeur).trim() !== '') renseignees[nom] = valeur
  }

  let erreurs = []
  try {
    erreurs = noyau.validate(renseignees, profil, {
      vercel: surVercel,
      publicPem: clePublique,
      // Un poste de développement utilise http://localhost : l'interdire
      // rendrait le profil desktop invalide en permanence.
      allowLocalHttp: cible === 'desktop' || cible === 'development',
      allowedBlobHashes: options.jetonsBlobAutorises,
    })
  } catch (erreur) {
    erreurs = ['Validation interrompue : ' + String(erreur.message).slice(0, 200)]
  }

  return { erreurs, vides, profil }
}

/**
 * Filtre les erreurs qui ne concernent pas les variables réellement gérées
 * pour cette cible. `validate` exige par exemple `DIRECT_URL` pour tout profil
 * PWA, ce qui est juste pour un serveur mais hors sujet quand on ne configure
 * que la cible `development` d'un projet dont la base est fournie par une
 * intégration.
 */
function erreursPertinentes(erreurs, nomsGeres, options = {}) {
  const geres = new Set(nomsGeres)
  // Variables présentes chez Vercel mais protégées en lecture. `validate` ne
  // reçoit pas leur valeur — elle n'est pas lisible — et conclut « requis ».
  // C'est faux : la variable EST configurée. Sans ce filtre, un projet
  // parfaitement provisionné se verrait reprocher huit variables manquantes.
  const enPlaceNonRelisibles = new Set(options.presentsNonRelisibles || [])
  return erreurs.filter((message) => {
    const texte = String(message)
    const nom = texte.split(/\s*[:/]/)[0].trim()
    if (!nom) return true
    // Un message global (sans nom de variable identifiable) est conservé.
    if (!/^[A-Z][A-Z0-9_]*$/.test(nom)) return true
    if (enPlaceNonRelisibles.has(nom) && /\brequis\b/i.test(texte)) return false
    return geres.has(nom)
  })
}

module.exports = { profilPour, valider, erreursPertinentes }

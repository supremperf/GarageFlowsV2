'use strict'
/**
 * CONTRÔLES DE SÛRETÉ DU DÉPÔT.
 *
 * Avant d'écrire le moindre secret sur disque, on vérifie que l'endroit où il
 * va n'est pas exposé. Trois questions, trois réponses vérifiables :
 *
 *   1. le fichier de destination est-il ignoré par Git ? Sinon, un `git add -A`
 *      publierait les identifiants de production ;
 *   2. un fichier d'exemple contient-il une vraie valeur ? C'est le mode de
 *      fuite le plus fréquent, parce qu'un `.env.example` est fait pour être
 *      versionné ;
 *   3. où est la racine du dépôt Git ? Un projet copié dans un dossier
 *      personnel peut se retrouver dans un dépôt qui couvre tout le profil
 *      utilisateur : les règles du `.gitignore` du projet s'appliquent alors
 *      depuis un autre point, ce qui change tout.
 *
 * Aucun contrôle n'est « supposé passé » faute d'information : si Git est
 * injoignable, on le dit, et on refuse d'affirmer que les fichiers sont ignorés.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const fsx = require('../utils/fsx.js')
const fichierEnv = require('../utils/env-file.js')

/** Exécution Git bornée : jamais de shell, jamais de sortie conservée. */
function git(racine, args) {
  return execFileSync('git', args, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })
}

/**
 * @param {string} racine racine du projet
 * @param {string[]} destinations fichiers que le configurateur va écrire
 */
function verifier(racine, destinations = []) {
  const rapport = {
    gitDisponible: false,
    racineDepot: null,
    projetDansLeDepot: null,
    fichiersSuivis: null,
    envSuivis: [],
    exemplesAvecSecrets: [],
    destinationsNonIgnorees: [],
    liensSymboliques: [],
    permissions: {},
    anomalies: [],
    avertissements: [],
  }

  // 1. Où est la racine du dépôt ?
  try {
    rapport.racineDepot = git(racine, ['rev-parse', '--show-toplevel']).trim()
    rapport.gitDisponible = true
  } catch {
    rapport.avertissements.push('Git injoignable ou dossier hors dépôt : impossible de PROUVER que les fichiers de secrets sont ignorés. '
      + 'Les fichiers sont tout de même écrits avec des permissions restreintes.')
  }

  if (rapport.gitDisponible) {
    const normaliser = (chemin) => path.resolve(chemin).replace(/\\/g, '/').replace(/\/+$/, '')
    rapport.projetDansLeDepot = normaliser(rapport.racineDepot) === normaliser(racine)
    try {
      const suivis = git(racine, ['ls-files', '-z', '--', '.']).split('\0').filter(Boolean)
      rapport.fichiersSuivis = suivis.length
      rapport.envSuivis = suivis.filter((nom) => /(?:^|\/)\.env(?:\.|$)/.test(nom) && !/\.example$/.test(nom))
      if (rapport.envSuivis.length) {
        rapport.anomalies.push('Fichiers d environnement SUIVIS par Git : ' + rapport.envSuivis.join(', ')
          + '. Les retirer de l index (git rm --cached) avant toute écriture de secret.')
      }
    } catch {
      rapport.avertissements.push('Inventaire Git des fichiers suivis indisponible.')
    }
    if (!rapport.projetDansLeDepot) {
      rapport.avertissements.push('Le dépôt Git détecté a pour racine « ' + rapport.racineDepot + ' », différente de celle du projet. '
        + 'Aucun fichier du projet n est donc versionné ici : les secrets ne risquent pas d être publiés par un commit, '
        + 'mais le projet n a pas non plus d historique — une erreur de configuration ne sera pas rattrapable par Git.')
    }

    // 2. Les destinations doivent être ignorées.
    for (const destination of destinations) {
      try {
        git(racine, ['check-ignore', '--no-index', '--quiet', '--', destination])
      } catch {
        rapport.destinationsNonIgnorees.push(destination)
      }
    }
    if (rapport.destinationsNonIgnorees.length) {
      rapport.anomalies.push('Destinations non couvertes par .gitignore : ' + rapport.destinationsNonIgnorees.join(', ')
        + '. Ajouter les règles avant d y écrire des secrets.')
    }
  }

  // 3. Fichiers d'exemple : ils sont faits pour être versionnés, donc ils ne
  //    doivent contenir aucune valeur réelle. On les lit sur DISQUE et pas
  //    seulement dans l'index : un exemple non encore suivi finira par l'être.
  const noyau = require(path.join(racine, 'scripts/config-core.cjs'))
  let entrees = []
  try {
    entrees = fs.readdirSync(racine)
  } catch { /* racine illisible : signalé plus haut */ }
  for (const nom of entrees.filter((nom) => /^\.env(?:\.[\w-]+)*\.example$/.test(nom))) {
    const texte = fsx.lireTexte(path.join(racine, nom))
    if (texte === null) continue
    const valeurs = fichierEnv.valeurs(texte)
    for (const [cle, valeur] of Object.entries(valeurs)) {
      if (!valeur) continue
      let motDePasse = false
      try { motDePasse = !!new URL(valeur).password } catch { /* pas une URL */ }
      const secretNomme = noyau.isSecret(cle) && !(cle === 'DATABASE_URL' && valeur.startsWith('file:'))
      if (secretNomme || motDePasse) rapport.exemplesAvecSecrets.push(nom + ' → ' + cle)
    }
  }
  if (rapport.exemplesAvecSecrets.length) {
    rapport.anomalies.push('Valeurs sensibles dans un fichier d exemple destiné au dépôt : '
      + rapport.exemplesAvecSecrets.join(', ') + '. Remplacer par des espaces réservés et renouveler les identifiants concernés.')
  }

  // 4. Liens symboliques sur le chemin d'une destination : la cible réelle
  //    serait ailleurs, potentiellement dans un dossier partagé.
  for (const destination of destinations) {
    const segments = destination.split(/[\\/]/)
    for (let index = 0; index < segments.length; index++) {
      const partiel = path.join(racine, ...segments.slice(0, index + 1))
      try {
        if (fs.lstatSync(partiel).isSymbolicLink()) rapport.liensSymboliques.push(destination)
      } catch { /* inexistant : rien à signaler */ }
    }
  }
  if (rapport.liensSymboliques.length) {
    rapport.anomalies.push('Lien symbolique sur le chemin de : ' + [...new Set(rapport.liensSymboliques)].join(', ')
      + '. Écriture refusée tant que la cible réelle n est pas vérifiée.')
  }

  // 5. Permissions constatables des fichiers sensibles déjà présents.
  for (const destination of destinations) {
    const etat = fsx.permissions(path.join(racine, destination))
    if (!etat.present) continue
    rapport.permissions[destination] = etat
    if (etat.lisibleParTous === true) {
      rapport.anomalies.push(destination + ' : lisible par tous les comptes du système ; permissions à restreindre.')
    }
  }

  rapport.ok = rapport.anomalies.length === 0
  return rapport
}

module.exports = { verifier }

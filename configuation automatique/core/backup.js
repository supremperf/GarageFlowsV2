'use strict'
/**
 * SAUVEGARDES ET RETOUR ARRIÈRE.
 *
 * Avant toute écriture, le contenu d'origine est copié dans un dossier privé
 * horodaté. Ce n'est pas une précaution de principe : les fichiers concernés
 * contiennent des clés qui, perdues, rendent illisibles des données chiffrées —
 * aucune régénération ne les récupérerait.
 *
 * Choix d'emplacement : `GarageFlow-configuration/sauvegardes/`, et non le
 * dossier du configurateur. La raison est dans le `.gitignore` du dépôt, qui
 * ignore `GarageFlow-configuration/` entièrement, avec ce commentaire :
 * « Sorties des scripts de configuration/rotation — peuvent contenir des
 * secrets en clair ». Une sauvegarde de `.env` EST un fichier de secrets : la
 * déposer dans un dossier susceptible d'être versionné serait la pire façon de
 * protéger une configuration.
 *
 * Le retour arrière ne restaure que ce qu'il reconnaît : si le fichier a été
 * modifié entre-temps par quelqu'un d'autre, on refuse plutôt que d'écraser un
 * travail qui n'est pas le nôtre.
 */

const fs = require('node:fs')
const path = require('node:path')

const fsx = require('../utils/fsx.js')

/** Horodatage de dossier, sûr pour un nom de fichier Windows. */
function horodatage(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function dossierSauvegardes(racine) {
  return fsx.dossierPrive(path.join(racine, 'GarageFlow-configuration', 'sauvegardes'))
}

/**
 * Ouvre une session de sauvegarde.
 * @param {string} racine
 * @param {string} etiquette horodatage ou identifiant d'exécution
 */
function session(racine, etiquette = horodatage()) {
  const dossier = path.join(racine, 'GarageFlow-configuration', 'sauvegardes', etiquette)
  const entrees = []
  let dossierCree = false

  /**
   * Le dossier n'est créé qu'au premier fichier réellement sauvegardé.
   *
   * Sans cela, chaque exécution — y compris une simulation qui n'écrit rien —
   * laissait un dossier vide horodaté. Au bout de quelques essais, l'historique
   * des sauvegardes devient illisible et il faut deviner lesquelles contiennent
   * vraiment quelque chose.
   */
  function assurerDossier() {
    if (dossierCree) return dossier
    fsx.dossierPrive(dossierSauvegardes(racine))
    fsx.dossierPrive(dossier)
    dossierCree = true
    return dossier
  }

  /**
   * Sauvegarde un fichier avant modification.
   * Un fichier ABSENT est enregistré comme tel : le retour arrière doit alors
   * le supprimer, pas restaurer un contenu vide.
   */
  function sauvegarder(relatif) {
    const source = path.join(racine, relatif)
    const existant = entrees.find((entree) => entree.relatif === relatif)
    if (existant) return existant
    const texte = fsx.lireTexte(source)
    const entree = {
      relatif,
      present: texte !== null,
      empreinte: texte === null ? null : fsx.empreinte(texte),
      octets: texte === null ? 0 : Buffer.byteLength(texte, 'utf8'),
      copie: null,
    }
    if (texte !== null) {
      // Le point initial est remplacé : une copie nommée « .env » est un fichier
      // CACHÉ sous Windows comme sous Unix. L'opérateur qui ouvre le dossier de
      // sauvegardes verrait un dossier vide et conclurait que rien n'a été
      // sauvegardé — exactement au moment où il a besoin du contraire.
      const nomCopie = relatif.replace(/[\\/]/g, '__').replace(/^\./, 'point-')
      entree.copie = path.join(assurerDossier(), nomCopie)
      fsx.ecrireAtomique(entree.copie, texte, { mode: 0o600 })
    }
    entrees.push(entree)
    return entree
  }

  /** Index de session : décrit ce qui a été sauvegardé, sans aucune valeur. */
  function ecrireIndex(complement = {}) {
    const index = {
      version: 1,
      etiquette,
      cree: new Date().toISOString(),
      fichiers: entrees.map((entree) => ({
        fichier: entree.relatif,
        presentAvant: entree.present,
        octets: entree.octets,
        empreinte: entree.empreinte,
        copie: entree.copie ? path.basename(entree.copie) : null,
      })),
      ...complement,
    }
    fsx.ecrireAtomique(path.join(assurerDossier(), 'index.json'), JSON.stringify(index, null, 2) + '\n', { mode: 0o600 })
    return index
  }

  /**
   * Restaure l'état d'origine des fichiers sauvegardés.
   *
   * @param {{ seulement?: string[] }} options
   * @returns {{ restaures: string[], refuses: object[] }}
   */
  function restaurer(options = {}) {
    const seulement = options.seulement ? new Set(options.seulement) : null
    const restaures = []
    const refuses = []
    // Ordre inverse : les dernières écritures sont annulées d'abord.
    for (const entree of [...entrees].reverse()) {
      if (seulement && !seulement.has(entree.relatif)) continue
      const cible = path.join(racine, entree.relatif)
      const actuel = fsx.lireTexte(cible)
      try {
        if (!entree.present) {
          // Le fichier n'existait pas : on le retire, mais seulement s'il porte
          // encore ce que nous y avons écrit.
          if (actuel === null) continue
          if (entree.empreinteApres && fsx.empreinte(actuel) !== entree.empreinteApres) {
            refuses.push({
              fichier: entree.relatif,
              raison: 'modification concurrente après notre écriture : suppression refusée pour ne pas détruire le travail d un autre processus',
            })
            continue
          }
          fs.rmSync(cible, { force: true })
          restaures.push(entree.relatif)
          continue
        }
        const original = fsx.lireTexte(entree.copie)
        if (original === null) {
          refuses.push({ fichier: entree.relatif, raison: 'copie de sauvegarde illisible' })
          continue
        }
        if (actuel !== null && fsx.empreinte(actuel) === entree.empreinte) continue
        if (actuel !== null && entree.empreinteApres && fsx.empreinte(actuel) !== entree.empreinteApres) {
          refuses.push({
            fichier: entree.relatif,
            raison: 'modification concurrente : le fichier a changé après notre écriture, restauration refusée',
          })
          continue
        }
        fsx.ecrireAtomique(cible, original, { mode: 0o600 })
        const relu = fsx.lireTexte(cible)
        if (relu === null || fsx.empreinte(relu) !== entree.empreinte) {
          refuses.push({ fichier: entree.relatif, raison: 'restauration non confirmée à la relecture' })
          continue
        }
        restaures.push(entree.relatif)
      } catch (erreur) {
        refuses.push({ fichier: entree.relatif, raison: 'erreur système : ' + erreur.code })
      }
    }
    return { restaures, refuses }
  }

  /** Mémorise l'empreinte écrite, pour distinguer « notre écriture » d'une autre. */
  function noterEcriture(relatif, texte) {
    const entree = entrees.find((element) => element.relatif === relatif)
    if (entree) entree.empreinteApres = fsx.empreinte(texte)
  }

  return { dossier, etiquette, entrees, sauvegarder, ecrireIndex, restaurer, noterEcriture }
}

/** Liste les sessions de sauvegarde existantes, de la plus récente à la plus ancienne. */
function sessions(racine) {
  const dossier = path.join(racine, 'GarageFlow-configuration', 'sauvegardes')
  let noms = []
  try {
    noms = fs.readdirSync(dossier, { withFileTypes: true }).filter((entree) => entree.isDirectory()).map((entree) => entree.name)
  } catch {
    return []
  }
  return noms.sort().reverse()
}

module.exports = { horodatage, dossierSauvegardes, session, sessions }

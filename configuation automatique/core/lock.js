'use strict'
/**
 * VERROU D'EXÉCUTION ET ÉTAT DE REPRISE.
 *
 * Deux configurateurs lancés en parallèle sur le même dépôt se marcheraient
 * dessus de la pire façon possible : chacun lirait l'état « avant » de l'autre,
 * chacun générerait son propre secret, et le dernier à écrire gagnerait — en
 * laissant le fichier local et Vercel désaccordés.
 *
 * Le verrou est un fichier créé en mode exclusif (`wx`) : sa création est
 * atomique au niveau du système de fichiers, il n'y a donc pas de fenêtre entre
 * « tester » et « prendre ». Il porte le PID et l'horodatage, ce qui permet de
 * distinguer un verrou VIVANT (une autre exécution en cours) d'un verrou
 * ORPHELIN (processus tué, machine redémarrée). Un verrou orphelin est repris,
 * jamais écrasé à l'aveugle.
 *
 * L'état de reprise sert la même idée côté métier : chaque étape franchie est
 * enregistrée, pour qu'une relance ne refasse pas ce qui est déjà fait et ne
 * laisse pas une opération à moitié appliquée.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const fsx = require('../utils/fsx.js')

const AGE_ORPHELIN_MS = 2 * 60 * 60 * 1000

/** Dossier privé où vivent verrou, état et sauvegardes (hors dépôt versionné). */
function dossierPrive(racine) {
  return fsx.dossierPrive(path.join(racine, 'GarageFlow-configuration'))
}

function cheminVerrou(racine) {
  return path.join(dossierPrive(racine), 'configurateur.lock')
}

function cheminEtat(racine) {
  return path.join(dossierPrive(racine), 'configurateur-etat.json')
}

/** Vrai si un processus de ce PID existe encore. */
function processusVivant(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    // Signal 0 : ne tue rien, vérifie seulement l'existence et les droits.
    process.kill(pid, 0)
    return true
  } catch (erreur) {
    // EPERM signifie « existe mais appartient à un autre utilisateur ».
    return erreur.code === 'EPERM'
  }
}

/**
 * Prend le verrou.
 *
 * @returns {{ pris: true, fichier: string, liberer: Function }
 *           | { pris: false, raison: string, detenteur: object|null }}
 */
function prendre(racine, { force = false } = {}) {
  const fichier = cheminVerrou(racine)
  const contenu = {
    pid: process.pid,
    hote: os.hostname(),
    utilisateur: os.userInfo().username,
    debut: new Date().toISOString(),
    version: 1,
  }

  const ecrire = () => {
    fsx.ecrireAtomique(fichier, JSON.stringify(contenu, null, 2) + '\n', { mode: 0o600 })
  }

  try {
    // Création exclusive : si le fichier existe, EEXIST — pas de course.
    const descripteur = fs.openSync(fichier, 'wx', 0o600)
    fs.writeFileSync(descripteur, JSON.stringify(contenu, null, 2) + '\n')
    fs.closeSync(descripteur)
  } catch (erreur) {
    if (erreur.code !== 'EEXIST') throw erreur
    let detenteur = null
    try {
      detenteur = JSON.parse(fs.readFileSync(fichier, 'utf8'))
    } catch { /* verrou illisible : traité comme orphelin daté d'avant */ }

    const age = detenteur && detenteur.debut ? Date.now() - Date.parse(detenteur.debut) : Number.POSITIVE_INFINITY
    const vivant = detenteur && detenteur.hote === os.hostname() ? processusVivant(detenteur.pid) : null

    if (!force && vivant === true) {
      return {
        pris: false,
        raison: 'Une autre configuration est en cours (PID ' + detenteur.pid + ', démarrée le ' + detenteur.debut
          + '). Attendre sa fin, ou relancer avec --forcer-verrou si ce processus n existe plus.',
        detenteur,
      }
    }
    if (!force && vivant === null && Number.isFinite(age) && age < AGE_ORPHELIN_MS) {
      return {
        pris: false,
        raison: 'Un verrou récent appartient à une autre machine (' + (detenteur ? detenteur.hote : 'inconnue')
          + '). Son processus ne peut pas être vérifié d ici ; relancer avec --forcer-verrou après avoir confirmé qu aucune configuration ne tourne.',
        detenteur,
      }
    }
    // Verrou orphelin : processus absent, ou plus vieux que la durée maximale
    // d'une configuration. On le reprend en le remplaçant atomiquement.
    contenu.verrouPrecedent = detenteur || 'illisible'
    contenu.repriseOrpheline = true
    ecrire()
  }

  let libere = false
  return {
    pris: true,
    fichier,
    detenteur: contenu,
    liberer() {
      if (libere) return
      libere = true
      try {
        const actuel = JSON.parse(fs.readFileSync(fichier, 'utf8'))
        // Ne jamais libérer le verrou d'une autre exécution.
        if (actuel.pid !== process.pid) return
      } catch { /* illisible : on nettoie tout de même notre propre verrou */ }
      fs.rmSync(fichier, { force: true })
    },
  }
}

/** Lit l'état de reprise, ou rend un état neuf. */
function lireEtat(racine) {
  try {
    const etat = JSON.parse(fs.readFileSync(cheminEtat(racine), 'utf8'))
    if (!etat || etat.version !== 1 || !Array.isArray(etat.etapes)) return null
    return etat
  } catch {
    return null
  }
}

/** Écrit l'état de reprise (jamais de valeur secrète : noms et statuts seulement). */
function ecrireEtat(racine, etat) {
  const contenu = { version: 1, ...etat, misAJour: new Date().toISOString() }
  fsx.ecrireAtomique(cheminEtat(racine), JSON.stringify(contenu, null, 2) + '\n', { mode: 0o600 })
  return contenu
}

/** Supprime l'état de reprise après une exécution complète et cohérente. */
function effacerEtat(racine) {
  fs.rmSync(cheminEtat(racine), { force: true })
}

module.exports = { AGE_ORPHELIN_MS, dossierPrive, cheminVerrou, cheminEtat, processusVivant, prendre, lireEtat, ecrireEtat, effacerEtat }

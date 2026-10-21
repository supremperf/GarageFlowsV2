'use strict'
/**
 * FOURNISSEUR DE STOCKAGE.
 *
 * Deux mécanismes coexistent dans GarageFlows, et il importe de ne pas les
 * confondre :
 *
 *   · `GF_BACKUP_DIR` / `GF_PHOTOS_DIR` — des chemins de DISQUE LOCAL. Ils ont
 *     un sens sur un poste Electron ; sur Vercel, le système de fichiers est
 *     éphémère et non partagé entre instances. Les y déclarer simulerait un
 *     stockage durable qui n'existe pas : `config-core.validate()` refuse déjà
 *     cette combinaison, et le configurateur la signale.
 *
 *   · `BLOB_READ_WRITE_TOKEN` — un jeton Vercel Blob, rattaché à un store ET à
 *     un environnement précis. Un jeton valide dont le store n'est pas connecté
 *     au projet ne sert à rien ; l'inverse non plus. On vérifie donc
 *     l'association, pas seulement la forme du jeton.
 *
 * Aucune écriture dans le stockage n'est tentée : la sonde d'écriture Blob du
 * dépôt (`config-cloud.probeBlobWrite`) dépose puis supprime un objet, ce qui
 * reste une mutation chez le fournisseur. Elle n'est pas appelée ici.
 */

const fs = require('node:fs')
const path = require('node:path')

const redact = require('../security/redact.js')

const MOTIF_JETON = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9_-]+$/

/**
 * Contrôle le jeton Blob et son rattachement.
 *
 * @param {string} racine
 * @param {object} valeurs variables de la cible
 * @param {{ storeIds?: string[], compromis?: object[] }} options
 */
function verifierBlob(racine, valeurs, options = {}) {
  const resultat = {
    present: false, formeValide: false, storeDuJeton: null,
    associe: null, compromis: false, anomalies: [], consequence: null,
  }
  const jeton = valeurs.BLOB_READ_WRITE_TOKEN
  if (!jeton || !String(jeton).trim()) {
    resultat.consequence = 'Aucun stockage Blob configuré : les fonctions qui en dépendent restent inactives. Aucun jeton n est inventé.'
    return resultat
  }
  resultat.present = true
  redact.enregistrer(String(jeton))

  const credentials = require(path.join(racine, 'scripts/lib/config-credentials.cjs'))
  const compromis = options.compromis
    || JSON.parse(fs.readFileSync(path.join(racine, 'scripts/compromised-secrets.json'), 'utf8')).entries
  if (credentials.compromised(String(jeton), compromis)) {
    resultat.compromis = true
    resultat.anomalies.push('BLOB_READ_WRITE_TOKEN : jeton connu exposé. Le révoquer dans Vercel Blob et en émettre un nouveau ; '
      + 'aucun contrôle ne peut rendre sûr un jeton publié.')
    return resultat
  }

  const correspondance = MOTIF_JETON.exec(String(jeton).trim())
  if (!correspondance) {
    resultat.anomalies.push('BLOB_READ_WRITE_TOKEN : format non reconnu par @vercel/blob ; coller le jeton complet.')
    return resultat
  }
  resultat.formeValide = true
  resultat.storeDuJeton = correspondance[1].toLowerCase()

  if (!options.storeIds) {
    resultat.associe = null
    resultat.consequence = 'Association au projet non vérifiée : inventaire des stores Blob non disponible pour ce compte.'
    return resultat
  }
  resultat.associe = options.storeIds.some((identifiant) =>
    String(identifiant).replace(/^store_/, '').toLowerCase() === resultat.storeDuJeton)
  if (!resultat.associe) {
    resultat.anomalies.push('BLOB_READ_WRITE_TOKEN : aucun store Blob connecté à ce projet et à cet environnement ne correspond au jeton. '
      + 'Dans Vercel > Storage > store > Connect Project, cocher cette cible. Aucun rattachement automatique.')
  }
  return resultat
}

/**
 * Contrôle les chemins de disque local, et refuse qu'ils soient déclarés pour
 * une cible Vercel.
 */
function verifierChemins(valeurs, { cibleVercel = false } = {}) {
  const resultat = { chemins: {}, anomalies: [] }
  for (const nom of ['GF_BACKUP_DIR', 'GF_PHOTOS_DIR']) {
    const valeur = valeurs[nom]
    if (!valeur) continue
    if (cibleVercel) {
      resultat.anomalies.push(nom + ' : un chemin de disque local n est pas persistant sur Vercel (système de fichiers éphémère, non partagé entre instances). '
        + 'Ne pas déclarer cette variable pour un environnement Vercel.')
      continue
    }
    const normalise = String(valeur).replace(/^"(.*)"$/, '$1').replace(/\\/g, '/')
    let etat = 'absent'
    try {
      etat = fs.statSync(normalise).isDirectory() ? 'dossier' : 'fichier-inattendu'
    } catch {
      etat = 'absent'
    }
    resultat.chemins[nom] = { chemin: normalise, etat }
    if (etat === 'fichier-inattendu') resultat.anomalies.push(nom + ' : le chemin désigne un fichier, un dossier est attendu.')
  }
  return resultat
}

/**
 * Inventaire des stores Blob connectés au projet, en lecture seule.
 * Réutilise `config-cloud.blobStores`, qui croise plusieurs endpoints avant de
 * conclure qu'un store n'est pas rattaché — une liste incomplète ne doit pas
 * se transformer en « non associé ».
 */
async function inventaireBlob(racine, clientVercel, projet, cible, snapshot) {
  try {
    const nuage = require(path.join(racine, 'scripts/lib/config-cloud.cjs'))
    const api = {
      root: racine,
      tool: async (_nom, args) => clientVercel.commande(args),
      yes: async () => false,
      select: async () => { throw new Error('Sélection interactive indisponible en mode automatique.') },
    }
    const pont = nuage.cloud(api)
    const identifiants = await pont.blobStores(projet, cible, { records: snapshot.enregistrements })
    return { disponible: true, storeIds: identifiants, erreur: null }
  } catch (erreur) {
    return { disponible: false, storeIds: null, erreur: redact.nettoyer(erreur.message).slice(0, 200) }
  }
}

module.exports = { MOTIF_JETON, verifierBlob, verifierChemins, inventaireBlob }

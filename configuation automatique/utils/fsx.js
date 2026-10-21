'use strict'
/**
 * Écritures sûres sur disque : atomiques, privées, sans laisser de copie en clair.
 *
 * Le configurateur manipule des secrets. Trois propriétés sont donc non
 * négociables ici :
 *  1. ATOMICITÉ — un fichier d'environnement ne doit jamais être observé
 *     tronqué : une interruption pendant l'écriture rendrait l'application
 *     incapable de démarrer. On écrit un temporaire exclusif, puis on renomme.
 *  2. PERMISSIONS — le descripteur reçoit son mode AVANT d'être renommé, sur
 *     le même objet ouvert : un chmod effectué après `rename` porterait sur un
 *     chemin qui a pu être remplacé entre-temps.
 *  3. REFUS DES LIENS — un lien symbolique en place du fichier cible ferait
 *     écrire le secret ailleurs (dossier partagé, dossier suivi par Git).
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

/** Lecture texte tolérante : un fichier absent rend `null`, jamais une exception. */
function lireTexte(fichier) {
  try {
    return fs.readFileSync(fichier, 'utf8')
  } catch (erreur) {
    if (erreur.code === 'ENOENT') return null
    throw erreur
  }
}

/** Vrai si le chemin existe (fichier, dossier ou lien), sans suivre les liens. */
function existe(chemin) {
  try {
    fs.lstatSync(chemin)
    return true
  } catch {
    return false
  }
}

/** Refuse d'écrire sur un lien symbolique : la cible réelle est inconnue. */
function refuserLien(fichier) {
  try {
    if (fs.lstatSync(fichier).isSymbolicLink()) {
      throw new Error(`${path.basename(fichier)} : lien symbolique refusé pour un fichier de configuration.`)
    }
  } catch (erreur) {
    if (erreur.code !== 'ENOENT') throw erreur
  }
}

/**
 * Écrit un fichier de façon atomique avec des permissions restreintes.
 *
 * @param {string} fichier chemin absolu
 * @param {string} texte contenu complet
 * @param {{ mode?: number, exclusif?: boolean }} options
 *        `mode` : permissions POSIX appliquées au descripteur.
 *        `exclusif` : échoue si le fichier existe déjà. Indispensable pour un
 *        matériel de clé — remplacer une clé privée existante, même « par
 *        accident de concurrence », détruirait une autorité de confiance.
 */
function ecrireAtomique(fichier, texte, { mode = 0o600, exclusif = false } = {}) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 })
  refuserLien(fichier)
  if (exclusif) {
    // La réservation et les permissions portent sur le même objet ouvert : il
    // n'y a aucun instant où le fichier existe avec des droits plus larges.
    const descripteur = fs.openSync(fichier, 'wx', mode)
    try {
      fs.writeFileSync(descripteur, texte)
      try { fs.fchmodSync(descripteur, mode) } catch { /* Windows : ACL héritée */ }
      fs.fsyncSync(descripteur)
    } finally {
      fs.closeSync(descripteur)
    }
    return
  }
  const temporaire = `${fichier}.${crypto.randomBytes(8).toString('hex')}.tmp`
  let reserve = false
  try {
    const fd = fs.openSync(temporaire, 'wx', mode)
    reserve = true
    try {
      fs.writeFileSync(fd, texte)
      // Même objet ouvert : le mode ne peut pas être appliqué à un autre fichier.
      try { fs.fchmodSync(fd, mode) } catch { /* Windows : ACL héritée du profil utilisateur */ }
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporaire, fichier)
    reserve = false
  } finally {
    if (reserve) fs.rmSync(temporaire, { force: true })
  }
}

/** Crée un dossier privé (0700) s'il manque, et rend son chemin. */
function dossierPrive(chemin) {
  fs.mkdirSync(chemin, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(chemin, 0o700) } catch { /* Windows */ }
  return chemin
}

/**
 * Lisibilité par d'autres comptes, telle qu'on peut la constater sous Windows.
 *
 * `fs.stat().mode` ne reflète pas les ACL NTFS : Node rend 0o666 pour presque
 * tout fichier non lecture-seule. On ne prétend donc pas mesurer les ACL — on
 * rapporte ce qui est vérifiable, et on nomme explicitement la limite.
 */
function permissions(fichier) {
  try {
    const etat = fs.statSync(fichier)
    const mode = etat.mode & 0o777
    return {
      present: true,
      mode: mode.toString(8).padStart(3, '0'),
      // Sous Windows, seul le bit lecture-seule est porté par `mode` : un
      // 0o666 n'autorise personne de plus que les ACL du dossier utilisateur.
      modeSignificatif: process.platform !== 'win32',
      lisibleParTous: process.platform === 'win32' ? null : (mode & 0o044) !== 0,
    }
  } catch {
    return { present: false, mode: null, modeSignificatif: false, lisibleParTous: null }
  }
}

/** Empreinte SHA-256 d'un texte : sert de preuve d'intégrité, jamais de valeur. */
function empreinte(texte) {
  return crypto.createHash('sha256').update(String(texte), 'utf8').digest('hex')
}

module.exports = { lireTexte, existe, refuserLien, ecrireAtomique, dossierPrive, permissions, empreinte }

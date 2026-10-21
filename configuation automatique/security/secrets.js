'use strict'
/**
 * Génération de secrets symétriques.
 *
 * Un seul générateur est utilisé : `crypto.randomBytes`, qui s'appuie sur le
 * CSPRNG du système (BCryptGenRandom sous Windows). `Math.random` n'apparaît
 * nulle part dans le configurateur — un test de la suite le vérifie sur
 * l'ensemble des fichiers.
 *
 * Le format n'est pas un détail esthétique : chaque consommateur du dépôt attend
 * un encodage précis, et une clé AES-256-GCM lue par `Buffer.from(v,'base64')`
 * doit faire exactement 32 octets après décodage. Les spécifications viennent
 * donc de trois sources croisées, et une divergence est signalée plutôt que
 * tranchée en silence :
 *   · `scripts/garageflow-env-manifest.json` (generationFormat, recommendedBytes) ;
 *   · `scripts/config-core.cjs` (GENERATED : l'encodage réellement produit) ;
 *   · `core.validate()` (la longueur et la forme réellement acceptées).
 *
 * Toute valeur produite est RELUE et VALIDÉE avant d'être rendue. Un secret
 * qu'on ne sait pas revalider n'est pas un secret utilisable.
 */

const crypto = require('node:crypto')

/**
 * Spécifications par variable : encodage, taille d'entropie, longueur attendue.
 * `verifier` reçoit la valeur encodée et confirme qu'un consommateur la lira.
 */
const SPECIFICATIONS = {
  NEXTAUTH_SECRET: { encodage: 'base64', octets: 32, minimum: 32 },
  DEVICE_TOKEN_PEPPER: { encodage: 'base64', octets: 32, minimum: 32 },
  GF_PORTAL_SECRET: { encodage: 'base64', octets: 32, minimum: 32 },
  GF_SIGNATURE_SECRET: { encodage: 'base64', octets: 32, minimum: 32 },
  GF_BACKUP_KEY: { encodage: 'base64', octets: 32, minimum: 32, aes: true },
  GF_SMTP_CIPHER_KEY: { encodage: 'base64', octets: 32, minimum: 32, aes: true },
  GF_EINVOICE_CREDENTIALS_KEY: { encodage: 'base64', octets: 32, minimum: 32, aes: true },
  GF_TOTP_ENC_KEY: { encodage: 'base64', octets: 32, minimum: 32 },
  GARAGEFLOW_API_KEY: { encodage: 'hex', octets: 32, minimum: 16 },
  GF_DB_MAC_SECRET: { encodage: 'hex', octets: 32, minimum: 32 },
  GF_INTERNAL_EXPORT_KEY: { encodage: 'hex', octets: 32, minimum: 16 },
  EINVOICING_QUEUE_TOKEN: { encodage: 'hex', octets: 32, minimum: 32 },
  CRON_SECRET: { encodage: 'hex', octets: 32, minimum: 32 },
}

/** Motifs de secrets factices refusés par `core.validate` : jamais produits ici. */
const MOTIFS_FAIBLES = /change.?me|placeholder|example|your-secret|votre_secret|replace_with|fallback-/i

/** Clé AES-256 en base64, telle que `config-core.aesValid` l'exige. */
function aesValide(valeur) {
  return /^[A-Za-z0-9+/]{43}=$/.test(valeur) && Buffer.from(valeur, 'base64').length === 32
}

/** Vrai si le nom a une spécification de génération connue. */
function generable(nom) {
  return Object.prototype.hasOwnProperty.call(SPECIFICATIONS, nom)
}

/** Spécification d'une variable (copie, pour éviter toute mutation accidentelle). */
function specification(nom) {
  return generable(nom) ? { ...SPECIFICATIONS[nom] } : null
}

/**
 * Contrôle qu'une valeur générée est réellement exploitable.
 * @returns {string[]} anomalies ; vide signifie « utilisable »
 */
function anomalies(nom, valeur) {
  const specifications = SPECIFICATIONS[nom]
  const problemes = []
  if (typeof valeur !== 'string' || valeur.trim() === '') return [nom + ' : valeur vide.']
  if (!specifications) return [nom + ' : aucune spécification de génération ; génération refusée.']
  if (/[\s\0\r\n]/.test(valeur)) problemes.push(nom + ' : la valeur ne doit pas contenir d espace ni de saut de ligne.')
  if (valeur.length < specifications.minimum) problemes.push(nom + ' : longueur inférieure au minimum attendu (' + specifications.minimum + ').')
  if (MOTIFS_FAIBLES.test(valeur)) problemes.push(nom + ' : motif de secret générique refusé.')
  if (specifications.encodage === 'hex' && !new RegExp('^[0-9a-f]{' + specifications.octets * 2 + '}$').test(valeur)) {
    problemes.push(nom + ' : hexadécimal de ' + specifications.octets + ' octets attendu.')
  }
  if (specifications.encodage === 'base64') {
    const decode = Buffer.from(valeur, 'base64')
    if (decode.length !== specifications.octets) problemes.push(nom + ' : ' + specifications.octets + ' octets attendus après décodage base64.')
    // Aller-retour : une valeur base64 qui ne se réencode pas à l'identique
    // serait tronquée ou mal alignée chez le consommateur.
    if (decode.toString('base64') !== valeur) problemes.push(nom + ' : base64 non canonique.')
  }
  if (specifications.aes && !aesValide(valeur)) problemes.push(nom + ' : clé AES-256 en base64 (43 caractères + "=") attendue.')
  // Garde-fou contre un générateur défaillant : une sortie constante passerait
  // tous les contrôles de format ci-dessus.
  const octets = specifications.encodage === 'hex' ? Buffer.from(valeur, 'hex') : Buffer.from(valeur, 'base64')
  if (octets.length && octets.every((octet) => octet === octets[0])) problemes.push(nom + ' : entropie nulle détectée ; génération refusée.')
  return problemes
}

/**
 * Génère un secret pour `nom`, le valide, et rend sa valeur.
 *
 * @param {string} nom variable canonique
 * @param {{ exclure?: Set<string>, aleatoire?: (n:number)=>Buffer }} options
 *        `exclure` : valeurs déjà attribuées, pour refuser une collision
 *        `aleatoire` : injection réservée aux tests de robustesse
 * @returns {{ valeur: string, encodage: string, octets: number }}
 */
function generer(nom, options = {}) {
  const specifications = SPECIFICATIONS[nom]
  if (!specifications) throw new Error(nom + ' : génération non autorisée (aucune spécification).')
  const aleatoire = options.aleatoire || ((taille) => crypto.randomBytes(taille))
  const exclure = options.exclure || new Set()

  for (let tentative = 0; tentative < 8; tentative++) {
    const brut = aleatoire(specifications.octets)
    if (!Buffer.isBuffer(brut) || brut.length !== specifications.octets) {
      throw new Error(nom + ' : source aléatoire invalide ; génération refusée.')
    }
    const valeur = brut.toString(specifications.encodage)
    if (exclure.has(valeur)) continue
    const problemes = anomalies(nom, valeur)
    if (!problemes.length) return { valeur, encodage: specifications.encodage, octets: specifications.octets }
    // Une seule cause peut être retentée : la base64 non canonique n'existe pas
    // avec randomBytes, mais un générateur injecté peut la produire.
    if (problemes.some((probleme) => !/base64 non canonique|entropie nulle/.test(probleme))) {
      throw new Error(problemes[0])
    }
  }
  throw new Error(nom + ' : génération impossible après plusieurs tentatives ; aucune valeur écrite.')
}

/**
 * Vérifie qu'une valeur EXISTANTE est conforme — sert à décider « réutiliser »
 * plutôt que « remplacer ». Une valeur conforme n'est jamais régénérée.
 */
function conforme(nom, valeur) {
  if (!generable(nom)) return { conforme: true, anomalies: [] }
  const problemes = anomalies(nom, valeur)
  return { conforme: problemes.length === 0, anomalies: problemes }
}

module.exports = { SPECIFICATIONS, MOTIFS_FAIBLES, aesValide, generable, specification, anomalies, generer, conforme }

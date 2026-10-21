'use strict'
/**
 * Dernier rempart contre la fuite d'un secret dans un journal ou un rapport.
 *
 * Le configurateur n'écrit en principe jamais de valeur : il manipule des noms,
 * des statuts et des empreintes. Ce module existe parce que « en principe » ne
 * suffit pas pour un outil qui détient les identifiants de production :
 *
 *  · `enregistrer()` mémorise chaque valeur sensible manipulée pendant la
 *    session (en mémoire seulement) ;
 *  · `nettoyer()` remplace toute occurrence de ces valeurs par un marqueur,
 *    y compris à l'intérieur d'un message d'erreur d'un fournisseur ;
 *  · `motifsDangereux` rattrape ce que la liste ne connaît pas encore : jeton
 *    Vercel/Blob/Upstash, URL avec mot de passe, clé privée PEM, JWT.
 *
 * Un test de la suite vérifie qu'aucune valeur secrète connue n'apparaît dans un
 * rapport produit par le pipeline complet.
 */

const crypto = require('node:crypto')

const MARQUEUR = '[valeur masquée]'
const LONGUEUR_MINIMALE = 8

/** Valeurs à masquer, pour cette session uniquement : jamais écrites sur disque. */
const sensibles = new Set()

/** Mémorise une valeur à masquer dans toute sortie ultérieure. */
function enregistrer(valeur) {
  if (typeof valeur !== 'string') return
  const propre = valeur.trim()
  // Les valeurs très courtes (« on », « 0 », « false ») produiraient un
  // masquage absurde de messages entiers sans rien protéger.
  if (propre.length < LONGUEUR_MINIMALE) return
  sensibles.add(propre)
  // Un mot de passe d'URL est aussi dangereux isolément : la connexion peut être
  // reconstruite depuis l'hôte, qui lui n'est pas secret.
  try {
    const url = new URL(propre)
    if (url.password) {
      const motDePasse = decodeURIComponent(url.password)
      if (motDePasse.length >= LONGUEUR_MINIMALE) sensibles.add(motDePasse)
      if (url.password.length >= LONGUEUR_MINIMALE) sensibles.add(url.password)
    }
  } catch { /* ce n'est pas une URL */ }
}

/**
 * Vrai si la valeur elle-même porte les marques d'un secret, indépendamment du
 * nom de la variable. Sert à ne pas masquer ce qui n'a pas besoin de l'être.
 *
 * Masquer tout, y compris un nom d'hôte, rend les rapports illisibles : un
 * diagnostic où la base est désignée par « [valeur masquée] » n'aide personne à
 * savoir QUELLE base a répondu. On masque donc ce qui est réellement sensible.
 */
function ressembleAUnSecret(valeur) {
  const propre = String(valeur === undefined || valeur === null ? '' : valeur).trim()
  if (propre.length < LONGUEUR_MINIMALE) return false
  try {
    const url = new URL(propre)
    // Une URL avec identifiants est sensible ; une URL publique ne l'est pas.
    if (url.password || url.username) return true
    return false
  } catch { /* ce n'est pas une URL */ }
  if (/^(?:vercel_blob_rw_|sk-ant-|npg_|gh[pousr]_|eyJ)/.test(propre)) return true
  // Matériel de clé encodé : hexadécimal ou base64 long, sans espace.
  if (/^[0-9a-f]{32,}$/i.test(propre)) return true
  if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(propre)) return true
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(propre)) return true
  return false
}

/**
 * Noms qui désignent un secret. Même règle que `config-core.isSecret`, répétée
 * ici pour que ce module reste autonome — il est le dernier rempart, il ne doit
 * pas pouvoir échouer parce qu'une dépendance manque.
 */
const NOM_SENSIBLE = /SECRET|KEY|TOKEN|PEPPER|PASSWORD|(?:^|_)PASS(?:_|$)|DSN|CREDENTIAL|AUTHORIZATION|DATABASE_URL|DIRECT_URL/i

/**
 * Décide si un couple (nom, valeur) doit être masqué.
 *
 * Deux exceptions comptent, et elles sont concrètes :
 *
 *   · `DATABASE_URL=file:./dev.db` n'est pas un secret, c'est un chemin de
 *     fichier local. Le surveiller faisait masquer la chaîne « file:./dev.db »
 *     PARTOUT, y compris dans les notes du manifeste qui l'expliquent — et le
 *     rapport était alors refusé pour une fuite inexistante.
 *   · `GF_EINVOICE_CREDENTIALS_KEY_VERSION` porte un numéro de version, pas une
 *     clé : même raisonnement, et le dépôt fait déjà cette exception.
 */
function estSensible(nom, valeur) {
  const propre = String(valeur === undefined || valeur === null ? '' : valeur).trim()
  if (!propre) return false
  if ((nom === 'DATABASE_URL' || nom === 'DIRECT_URL') && /^file:/i.test(propre)) return false
  if (nom === 'GF_EINVOICE_CREDENTIALS_KEY_VERSION') return false
  if (NOM_SENSIBLE.test(String(nom))) return true
  return ressembleAUnSecret(propre)
}

/**
 * Enregistre les valeurs d'un dictionnaire de variables.
 *
 * @param {object} variables
 * @param {{ estSensible?: (nom: string, valeur: string) => boolean }} options
 *        Par défaut, `estSensible` ci-dessus décide. Un appelant peut fournir
 *        son propre prédicat, ou `() => true` pour tout surveiller.
 */
function enregistrerTout(variables, options = {}) {
  const predicat = options.estSensible || estSensible
  for (const [nom, valeur] of Object.entries(variables || {})) {
    if (!predicat(nom, valeur)) continue
    enregistrer(valeur)
  }
}

/** Nombre de valeurs surveillées — utile aux tests, jamais les valeurs. */
function tailleSurveillance() {
  return sensibles.size
}

/** Réinitialise la surveillance (tests, ou fin de session). */
function reinitialiser() {
  sensibles.clear()
}

const motifsDangereux = [
  // Jetons fournisseurs reconnaissables à leur préfixe.
  { nom: 'jeton-blob', motif: /vercel_blob_rw_[A-Za-z0-9_-]{8,}/g },
  { nom: 'jeton-anthropic', motif: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { nom: 'jeton-github', motif: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { nom: 'jeton-neon', motif: /npg_[A-Za-z0-9]{8,}/g },
  { nom: 'jeton-upstash', motif: /\bA[A-Za-z0-9]{40,}\b/g },
  // Jeton web signé : trois segments base64url séparés par des points.
  { nom: 'jeton-jwt', motif: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Matériel de clé.
  { nom: 'cle-privee-pem', motif: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // Identifiants dans une URL : on garde le schéma et l'hôte, on coupe le reste.
  { nom: 'url-avec-identifiants', motif: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/:@]+:[^\s/@]+@/gi },
]

/**
 * Masque les valeurs sensibles d'un texte.
 * @param {unknown} entree texte, erreur ou valeur quelconque
 * @returns {string} texte sûr à journaliser
 */
function nettoyer(entree) {
  if (entree === undefined || entree === null) return ''
  let texte = entree instanceof Error ? String(entree.message) : String(entree)
  // Les valeurs les plus longues d'abord : masquer un fragment avant son
  // englobant laisserait le reste de l'englobant en clair.
  for (const valeur of [...sensibles].sort((a, b) => b.length - a.length)) {
    if (!valeur) continue
    texte = texte.split(valeur).join(MARQUEUR)
  }
  for (const { motif } of motifsDangereux) {
    texte = texte.replace(motif, (correspondance, schema) => (schema ? schema + '://' + MARQUEUR + '@' : MARQUEUR))
  }
  return texte
}

/** Vrai si le texte contient encore une valeur surveillée ou un motif dangereux. */
function contientSecret(texte) {
  const brut = String(texte === undefined || texte === null ? '' : texte)
  for (const valeur of sensibles) {
    if (valeur && brut.includes(valeur)) return true
  }
  return motifsDangereux.some(({ motif }) => {
    motif.lastIndex = 0
    return motif.test(brut)
  })
}

/** Empreinte SHA-256 : preuve de synchronisation, jamais la valeur. */
function empreinte(valeur) {
  return crypto.createHash('sha256').update(String(valeur), 'utf8').digest('hex')
}

/** Empreinte abrégée, pour un affichage humain non réversible en pratique. */
function empreinteCourte(valeur) {
  return empreinte(valeur).slice(0, 12)
}

module.exports = {
  MARQUEUR, enregistrer, enregistrerTout, nettoyer, contientSecret, ressembleAUnSecret, estSensible,
  empreinte, empreinteCourte, reinitialiser, tailleSurveillance, motifsDangereux,
}

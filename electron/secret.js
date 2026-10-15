'use strict'

/**
 * Secret local Electron — UNIQUE PAR INSTALLATION, jamais codé en dur.
 *
 * Ce secret sert à signer/vérifier le cookie de session `gf_session` (HS256) et
 * à alimenter NEXTAUTH_SECRET du serveur Next.js interne. Un secret partagé et
 * prévisible permettrait de forger une session admin sur n'importe quelle
 * installation → il est donc INTERDIT d'utiliser une constante de repli.
 *
 * Politique :
 *  - si un NEXTAUTH_SECRET FORT est déjà fourni (ex. .env de développement),
 *    on le respecte pour garder les JWT cohérents entre redémarrages ;
 *  - sinon on charge/génère un secret propre à l'installation, stocké dans
 *    `app.getPath('userData')/gf_secret.key` :
 *      • 32 octets aléatoires (crypto.randomBytes) → 256 bits d'entropie ;
 *      • écriture ATOMIQUE (fichier temporaire + rename) ;
 *      • permissions restrictives 0600 lorsque l'OS le permet ;
 *      • réutilisé tel quel aux démarrages suivants ;
 *      • régénéré uniquement si absent, vide ou manifestement corrompu ;
 *      • jamais journalisé, jamais renvoyé au renderer, jamais envoyé au réseau.
 *  - si le secret ne peut être ni chargé ni généré → on LÈVE (fail-closed) :
 *    la partie authentifiée refuse de démarrer.
 */

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

const SECRET_FILE = 'gf_secret.key'

/** Valeurs connues comme faibles / anciens replis à bannir. */
const KNOWN_WEAK = new Set([
  'gf-electron-local-secret-2026-xK9mP3qR',
  'fallback-dev-secret-change-in-production',
  'fallback-portal-secret-change-in-production',
  'CHANGE_ME_run_openssl_rand_base64_32',
  'changeme',
  'secret',
  'change_me',
])
const WEAK_MARKERS = ['change_me', 'change-me', 'placeholder', 'example', 'your-secret', 'votre_secret', 'replace_with']

/** Un secret est-il absent, trop court (<32 car.) ou manifestement générique ? */
function isWeakSecret(v) {
  if (!v || String(v).trim().length < 32) return true
  if (KNOWN_WEAK.has(v)) return true
  const low = String(v).toLowerCase()
  return WEAK_MARKERS.some((m) => low.includes(m))
}

/** 32 octets aléatoires en base64url → 256 bits, sans caractère spécial. */
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url')
}

/** Un contenu de fichier ressemble-t-il à un secret exploitable et non corrompu ? */
function looksValid(raw) {
  if (typeof raw !== 'string') return false
  const v = raw.trim()
  // base64url d'au moins 32 caractères, sans espace ni saut de ligne interne.
  return v.length >= 32 && /^[A-Za-z0-9_-]+$/.test(v)
}

/**
 * Charge (ou crée la première fois) le secret propre à l'installation.
 *
 * @param {string} userDataDir  répertoire retourné par app.getPath('userData')
 * @returns {string} le secret (jamais journalisé par l'appelant)
 * @throws si le secret ne peut être ni lu ni généré de façon sûre
 */
function loadOrCreateInstallSecret(userDataDir, fileName = SECRET_FILE) {
  if (!userDataDir || typeof userDataDir !== 'string') {
    throw new Error('userDataDir requis pour charger le secret local')
  }
  const SECRET_FILE = fileName
  const file = path.join(userDataDir, SECRET_FILE)

  // 1. Réutiliser un secret existant valide.
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8')
      if (looksValid(raw)) return raw.trim()
      // Fichier présent mais vide/corrompu → on régénère (comportement maîtrisé).
    }
  } catch (err) {
    // Lecture impossible (droits, IO) : on tente une régénération contrôlée ci-dessous.
    if (err && err.code && err.code !== 'ENOENT') {
      // Erreur non triviale : on ne masque pas, on tente l'écriture puis on lèvera si ça échoue.
    }
  }

  // 2. Générer + écrire de façon ATOMIQUE avec permissions restrictives.
  const value = generateSecret()
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
  } catch (_) { /* le dossier existe déjà en pratique */ }

  const tmp = path.join(userDataDir, `.${SECRET_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    // wx : échoue si le tmp existe déjà (évite d'écraser une écriture concurrente).
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try {
      fs.writeSync(fd, value, null, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    // rename atomique sur le même volume.
    fs.renameSync(tmp, file)
    try { fs.chmodSync(file, 0o600) } catch (_) { /* permissions best-effort (Windows) */ }
  } catch (err) {
    // Nettoyage du tmp en cas d'échec.
    try { fs.rmSync(tmp, { force: true }) } catch (_) {}

    // Course au premier démarrage : un autre process a peut-être écrit le fichier.
    try {
      const raw = fs.readFileSync(file, 'utf8')
      if (looksValid(raw)) return raw.trim()
    } catch (_) { /* ignore */ }

    throw new Error(`Impossible de créer le secret local de façon sûre : ${err.message}`)
  }

  return value
}

/**
 * Résout le secret à utiliser par le process principal.
 *  - respecte un NEXTAUTH_SECRET déjà FORT (dev/.env) ;
 *  - sinon charge/génère le secret par installation.
 * Ne journalise jamais la valeur. Lève si aucun secret sûr n'est disponible.
 *
 * @param {string} userDataDir
 * @param {string|undefined} envSecret  process.env.NEXTAUTH_SECRET
 * @returns {{ secret: string, source: 'env'|'install' }}
 */
function resolveMainSecret(userDataDir, envSecret) {
  if (envSecret && !isWeakSecret(envSecret)) {
    return { secret: envSecret, source: 'env' }
  }
  const secret = loadOrCreateInstallSecret(userDataDir)
  if (isWeakSecret(secret)) {
    throw new Error('Secret local invalide après génération')
  }
  return { secret, source: 'install' }
}

/** Fichier de la clé de chiffrement AU REPOS des secrets SMTP. */
const SMTP_CIPHER_KEY_FILE = 'gf_smtp_cipher.key'

/**
 * Clé de chiffrement AU REPOS des identifiants SMTP, propre à l'installation.
 *
 * L'application packagée n'embarque aucun `.env` : la variable
 * `GF_SMTP_CIPHER_KEY` n'était donc **jamais** fournie au serveur Next.js
 * interne. Or `/api/email` refuse — à juste titre — d'enregistrer un mot de
 * passe SMTP sans elle (503 « Chiffrement SMTP indisponible »). Résultat :
 * configurer un envoi d'e-mails était **impossible sur le poste**, quelle que
 * soit la manipulation (GF31-AUD-012).
 *
 * La clé est donc générée une fois et conservée dans `userData`, exactement
 * comme le secret de session : mêmes garanties (256 bits, écriture atomique,
 * permissions 0600, jamais journalisée) et surtout même **stabilité** — une clé
 * régénérée à chaque démarrage rendrait les mots de passe déjà enregistrés
 * définitivement indéchiffrables (§105).
 *
 * Une valeur d'environnement FORTE reste prioritaire : elle permet à un
 * déploiement serveur, ou à un poste dont l'exploitant gère lui-même ses
 * secrets, de conserver la main.
 *
 * @param {string} userDataDir
 * @param {string|undefined} envKey  process.env.GF_SMTP_CIPHER_KEY
 * @returns {{ key: string, source: 'env'|'install' }}
 */
function resolveSmtpCipherKey(userDataDir, envKey) {
  if (envKey && !isWeakSecret(envKey)) {
    return { key: envKey, source: 'env' }
  }
  const key = loadOrCreateInstallSecret(userDataDir, SMTP_CIPHER_KEY_FILE)
  if (isWeakSecret(key)) {
    throw new Error('Clé de chiffrement SMTP invalide après génération')
  }
  return { key, source: 'install' }
}

module.exports = {
  SECRET_FILE,
  SMTP_CIPHER_KEY_FILE,
  isWeakSecret,
  generateSecret,
  looksValid,
  loadOrCreateInstallSecret,
  resolveMainSecret,
  resolveSmtpCipherKey,
}

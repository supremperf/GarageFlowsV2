'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  Vérification des mises à jour SIGNÉES (Ed25519) — côté client Electron.
//
//  Un SHA-256 servi par le même serveur que le binaire ne protège pas contre la
//  compromission du serveur. Ici, on vérifie une SIGNATURE Ed25519 du manifeste
//  avec une clé PUBLIQUE embarquée (sûre à distribuer). La clé PRIVÉE ne se
//  trouve QUE côté serveur (variable d'environnement).
//
//  La sérialisation canonique DOIT être identique à src/lib/releases/manifest.ts
//  (garagesite3) : clés triées récursivement, JSON.stringify sans espaces.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')
const semver = require('./semver')

// Clés publiques de signature connues (rotation : ajouter la nouvelle sans retirer
// l'ancienne tant que des releases signées par elle circulent). keyId → PEM SPKI.
const PUBLIC_KEYS = {
  // CONSERVÉE, et elle doit l'être. Tout poste installé avant le 15/08/2026 ne
  // connaît QUE cette clé : la retirer couperait son canal de mise à jour, sans
  // recours logiciel. Sa clé privée est introuvable — recherche exhaustive du
  // disque le 15/08/2026, cf. AUDIT_PROGRESS.md — donc plus aucune release ne
  // peut être signée avec elle. L'ancre reste au cas où elle ressortirait d'un
  // coffre : c'est le SEUL chemin qui rétablirait la mise à jour du parc actuel.
  'gf-update-2026':
    '-----BEGIN PUBLIC KEY-----\n' +
    'MCowBQYDK2VwAyEAIOtQbThNMbHLi3LHn0W16TzE6CAm98T+/0ImUXGdQdk=\n' +
    '-----END PUBLIC KEY-----\n',
  // Clé COURANTE, créée le 15/08/2026 faute de pouvoir retrouver la précédente.
  // Elle ne vaut que pour les postes installés depuis un exécutable qui la
  // contient : les installations antérieures n'en ont pas connaissance et
  // rejetteront tout manifeste qu'elle signe. Une nouvelle clé ne répare pas un
  // parc, elle n'ouvre que l'avenir.
  'gf-update-2026-2':
    '-----BEGIN PUBLIC KEY-----\n' +
    'MCowBQYDK2VwAyEAMg/QIcT17B3ijL3tJh92rsh4a6Kco5AR2ySe4kKEa98=\n' +
    '-----END PUBLIC KEY-----\n',
}

const EXPECTED_PRODUCT = 'GarageFlow'
// Domaines autorisés pour l'URL de téléchargement (anti open-redirect / SSRF).
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.garageflows.fr',
  'garageflows.fr',
  'app.garageflows.fr',
])

/** Sérialisation canonique déterministe — IDENTIQUE au serveur. */
function canonicalize(value) {
  return JSON.stringify(sortDeep(value))
}
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortDeep(v[k]); return acc }, {})
  }
  return v
}

/** Un keyId est-il configuré côté client (donc la vérif de signature est active) ? */
function signingConfigured() {
  return Object.keys(PUBLIC_KEYS).length > 0
}

/** Vérifie la signature Ed25519 du manifeste. Ne lève jamais. */
function verifySignature(signed) {
  try {
    if (!signed || !signed.manifest || typeof signed.signature !== 'string') return false
    const keyId = signed.manifest.keyId
    const pem = PUBLIC_KEYS[keyId]
    if (!pem) return false // clé inconnue → refus
    const data = Buffer.from(canonicalize(signed.manifest), 'utf8')
    return crypto.verify(null, data, crypto.createPublicKey(pem), Buffer.from(signed.signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * Valide entièrement un manifeste signé pour CE client.
 * @returns {{ ok: true, manifest } | { ok: false, reason: string }}
 */
function validateManifest(signed, opts) {
  const { currentVersion, channel, platform, arch } = opts || {}

  if (!signingConfigured()) return { ok: false, reason: 'Aucune clé de vérification configurée.' }
  if (!signed || !signed.manifest) return { ok: false, reason: 'Manifeste absent.' }
  if (!verifySignature(signed)) return { ok: false, reason: 'Signature du manifeste invalide ou clé inconnue.' }

  const m = signed.manifest
  if (m.signatureAlgorithm !== 'Ed25519') return { ok: false, reason: 'Algorithme de signature non supporté.' }
  if (m.product !== EXPECTED_PRODUCT) return { ok: false, reason: `Produit inattendu : ${m.product}.` }
  if (platform && m.platform !== platform) return { ok: false, reason: `Plateforme incompatible (${m.platform}).` }
  if (arch && m.architecture !== arch) return { ok: false, reason: `Architecture incompatible (${m.architecture}).` }
  if (channel && m.channel !== channel) return { ok: false, reason: `Canal incompatible (${m.channel}).` }

  if (!/^[a-f0-9]{64}$/i.test(String(m.sha256 || ''))) return { ok: false, reason: 'Empreinte SHA-256 absente/invalide.' }
  if (!Number.isFinite(m.size) || m.size <= 0) return { ok: false, reason: 'Taille de fichier invalide.' }

  // Anti-downgrade : la version proposée doit être STRICTEMENT plus récente.
  if (currentVersion && !semver.isNewer(m.version, currentVersion)) {
    return { ok: false, reason: `Version non supérieure à l'installée (${m.version} ≤ ${currentVersion}).` }
  }

  // ── Palier obligatoire (`minVersion`) ───────────────────────────────────────
  // `scripts/sign-release-manifest.mjs` sait poser `minVersion` dans le manifeste
  // et le serveur central le transmet — mais PERSONNE ne le lisait. Ce champ
  // existe pour les publications qui ne savent pas partir de n'importe où :
  // migrations de base enchaînées, format de licence changé, dossier de données
  // déplacé. Un poste resté longtemps sur une vieille version sautait le palier
  // et appliquait directement la dernière : l'installation réussissait, et c'est
  // au premier démarrage que les données ne se lisaient plus.
  //
  // Refuser ici, c'est refuser AVANT de télécharger et avant de remplacer quoi
  // que ce soit. Le poste reste sur une version qui fonctionne.
  if (currentVersion && m.minVersion && semver.isNewer(m.minVersion, currentVersion)) {
    return {
      ok: false,
      reason: `Cette mise à jour exige la version ${m.minVersion} au minimum `
        + `(vous avez ${currentVersion}) : installez d'abord la version ${m.minVersion}.`,
    }
  }

  // URL de téléchargement : HTTPS + domaine explicitement autorisé.
  let host = ''
  try {
    const u = new URL(m.downloadUrl)
    if (u.protocol !== 'https:') return { ok: false, reason: 'URL de téléchargement non HTTPS.' }
    host = u.hostname
  } catch {
    return { ok: false, reason: 'URL de téléchargement invalide.' }
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(host)) return { ok: false, reason: `Domaine de téléchargement non autorisé : ${host}.` }

  return { ok: true, manifest: m }
}

/**
 * Une URL de téléchargement est-elle acceptable ? (GF31-AUD-057)
 *
 * `validateManifest` contrôlait l'URL du manifeste, mais le téléchargeur
 * suivait ensuite les redirections SANS rien revalider : un simple en-tête
 * `Location` suffisait à sortir de la liste blanche et à retomber en HTTP clair,
 * annulant les deux garanties. La règle vit donc ici, en un seul endroit, et
 * s'applique à CHAQUE saut.
 *
 * Le bouclage local est admis : c'est le serveur embarqué de l'application
 * elle-même qui sert les publications de la Zone Administrateur.
 *
 * @param {string} rawUrl
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkDownloadUrl(rawUrl) {
  let u
  try {
    u = new URL(String(rawUrl))
  } catch {
    return { ok: false, reason: 'URL de téléchargement invalide.' }
  }
  const host = u.hostname
  const boucleLocale = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  if (boucleLocale) {
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? { ok: true }
      : { ok: false, reason: `Protocole non autorisé : ${u.protocol}` }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'URL de téléchargement non HTTPS.' }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(host)) {
    return { ok: false, reason: `Domaine de téléchargement non autorisé : ${host}.` }
  }
  return { ok: true }
}

/**
 * Réduit une chaîne à un NOM de fichier, jamais à un chemin.
 *
 * Le téléchargeur nommait l'installateur d'après le dernier segment de l'URL,
 * décodé par `decodeURIComponent` et utilisé tel quel dans `path.join`. Un
 * chemin se terminant par « %2E%2E%5CGarageFlows.exe » redevenait
 * « ..\GarageFlows.exe » : le fichier s'écrivait HORS du dossier temporaire, à
 * un emplacement choisi par celui qui sert l'URL.
 *
 * On coupe donc tout séparateur — y compris ceux réapparus au décodage — puis
 * on ne garde que des caractères inertes. Un nom vide, ou fait uniquement de
 * points, retombe sur la valeur par défaut : `path.join(dossier, '..')`
 * désignerait le dossier parent.
 */
function nomFichierInstallateur(brut, defaut) {
  const nu = String(brut ?? '').replace(/\\/g, '/').split('/').pop() || ''
  const propre = nu.replace(/[^0-9A-Za-z._-]/g, '')
  if (!propre || /^\.+$/.test(propre)) return defaut
  return propre.slice(0, 120)
}

module.exports = {
  canonicalize,
  checkDownloadUrl,
  nomFichierInstallateur,
  verifySignature,
  validateManifest,
  signingConfigured,
  PUBLIC_KEYS,
  ALLOWED_DOWNLOAD_HOSTS,
}

'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Reconstruction de la clé secrète interne
//
//  La clé maîtresse n'apparaît JAMAIS en clair dans le code. Elle est :
//    • fragmentée en 4 morceaux ;
//    • chaque morceau est masqué par XOR avec un masque distinct ;
//    • reconstruite uniquement en mémoire au lancement (XOR des morceaux) ;
//    • jamais écrite sur le disque.
//
//  À partir de ce secret, on dérive (HKDF-SHA256, labels distincts) :
//    • la clé HMAC de vérification d'intégrité (manifeste) ;
//    • la clé AES-256 de (dé)chiffrement des ressources embarquées.
//
//  ⚠️ Honnêteté cryptographique : un secret embarqué dans un binaire distribué
//  peut, in fine, être extrait par un rétro-ingénieur déterminé qui exécute la
//  reconstruction. Cette technique élève fortement la barre (pas de chaîne en
//  clair, pas d'extraction statique triviale) mais ne remplace pas une
//  vérification côté serveur pour les décisions critiques (licences → déjà
//  faites côté serveur). Voir docs/SECURITY-HARDENING.md.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')

// Fragments masqués — générés aléatoirement au build (aucune valeur devinable).
const _f0 = [96,184,25,150,161,14,114,8,232,234,2,128,201,239,21,43,17,105,191,70,24,2,227,127,169,240,179,64,31,44,54,174]
const _m0 = [31,240,246,248,233,69,195,167,219,69,239,44,188,153,173,136,194,135,59,156,227,193,27,201,139,133,20,80,18,86,136,220]
const _f1 = [35,141,239,99,180,166,156,96,157,0,24,253,67,188,202,145,255,75,53,158,138,24,144,126,246,26,38,25,153,89,192,99]
const _m1 = [61,124,225,21,207,58,200,25,141,102,210,191,151,114,239,236,117,141,66,42,228,108,53,70,6,196,104,175,198,34,230,99]
const _f2 = [18,30,245,168,81,86,47,126,84,104,134,136,51,192,243,126,25,55,91,122,53,0,247,35,59,212,8,96,166,215,40,66]
const _m2 = [181,212,97,199,117,194,15,170,53,200,59,4,28,62,160,52,30,149,26,57,50,18,47,86,201,59,150,209,96,125,229,80]
const _f3 = [78,190,96,228,64,117,239,112,52,180,247,234,249,43,40,121,241,101,62,90,88,21,182,228,80,187,41,153,226,61,251,126]
const _m3 = [116,225,105,1,45,254,132,32,169,194,168,238,49,65,136,215,74,225,39,23,107,38,119,115,32,78,227,205,102,184,197,102]

let _cachedSecret = null

// Reconstruit le secret maître (32 octets) en mémoire.
function reconstructSecret() {
  if (_cachedSecret) return _cachedSecret
  const frags = [[_f0, _m0], [_f1, _m1], [_f2, _m2], [_f3, _m3]]
  const out = Buffer.alloc(32)
  for (const [f, m] of frags) {
    for (let i = 0; i < 32; i++) out[i] ^= (f[i] ^ m[i]) & 0xff
  }
  _cachedSecret = out
  return out
}

// HKDF-SHA256 → clé dérivée de 32 octets pour un usage (« info ») donné.
function deriveKey(info) {
  const secret = reconstructSecret()
  const salt = Buffer.from('GarageFlow::v2::kdf::salt', 'utf8')
  const dk = crypto.hkdfSync('sha256', secret, salt, Buffer.from(info, 'utf8'), 32)
  return Buffer.from(dk)
}

// Clé HMAC de vérification d'intégrité (build == runtime : PAS de liaison machine).
function getIntegrityKey() {
  return deriveKey('integrity-manifest-hmac')
}

// Clé AES-256 de (dé)chiffrement des ressources embarquées (identique pour tous
// les postes : les ressources livrées sont les mêmes → pas de liaison machine).
function getResourceKey() {
  return deriveKey('resource-encryption-aes256')
}

// Efface le secret de la mémoire (best-effort) — appelable après usage.
function wipe() {
  if (_cachedSecret) { _cachedSecret.fill(0); _cachedSecret = null }
}

module.exports = { getIntegrityKey, getResourceKey, wipe }

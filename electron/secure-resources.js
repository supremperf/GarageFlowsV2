'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Chiffrement des ressources internes (AES-256-GCM)
//
//  Les ressources sensibles (configuration, modèles, données) sont stockées
//  CHIFFRÉES sur le disque (fichiers .enc) et déchiffrées UNIQUEMENT en mémoire
//  par GarageFlow.exe. Aucun fichier sensible n'est laissé en clair sur le
//  disque : `decryptFileToMemory()` renvoie un Buffer, jamais un fichier.
//
//  La clé AES-256 est dérivée du secret fragmenté (secure-key.js) — jamais
//  stockée en clair. GCM fournit à la fois confidentialité ET intégrité
//  authentifiée (un fichier .enc modifié est rejeté au déchiffrement).
//
//  Format .enc : "GFENC1"(6) | iv(12) | authTag(16) | ciphertext(n)
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')
const fs = require('fs')
const { getResourceKey } = require('./secure-key')

const MAGIC = Buffer.from('GFENC1', 'utf8')
const IV_LEN = 12
const TAG_LEN = 16

function encryptBuffer(plain) {
  const key = getResourceKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  key.fill(0)
  return Buffer.concat([MAGIC, iv, tag, ct])
}

function decryptBuffer(enc) {
  if (!Buffer.isBuffer(enc) || enc.length < MAGIC.length + IV_LEN + TAG_LEN) {
    throw new Error('Ressource chiffrée invalide (trop courte).')
  }
  if (!enc.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Ressource chiffrée invalide (en-tête inconnu).')
  }
  const iv = enc.subarray(MAGIC.length, MAGIC.length + IV_LEN)
  const tag = enc.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN)
  const ct = enc.subarray(MAGIC.length + IV_LEN + TAG_LEN)
  const key = getResourceKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(ct), decipher.final()])
    return plain
  } finally {
    key.fill(0)
  }
}

// Déchiffre un .enc → Buffer en mémoire. Ne touche jamais le disque en clair.
function decryptFileToMemory(encPath) {
  return decryptBuffer(fs.readFileSync(encPath))
}

// (Build) Chiffre un fichier en clair → .enc.
function encryptFile(srcPath, destPath) {
  const out = destPath || srcPath + '.enc'
  fs.writeFileSync(out, encryptBuffer(fs.readFileSync(srcPath)))
  return out
}

module.exports = { encryptBuffer, decryptBuffer, decryptFileToMemory, encryptFile, MAGIC }

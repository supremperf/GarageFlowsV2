'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — État local SIGNÉ (anti-altération), pur et testable.
//
//  Certains fichiers d'état de licence (dernière connexion, horloge de confiance)
//  étaient stockés en JSON clair, donc éditables à la main pour :
//   • entretenir indéfiniment la période de grâce hors ligne ;
//   • défaire la détection de recul d'horloge.
//
//  On les signe désormais avec un HMAC-SHA256 lié :
//   • au SECRET d'installation (clé HMAC) — propre à cette installation ;
//   • à l'empreinte matérielle (hwid) — un fichier copié d'une autre machine est
//     rejeté.
//  Toute valeur non signée, falsifiée, ou liée à un autre appareil → rejetée
//  (fail-closed : la grâce n'est PAS prolongée).
//
//  ⚠️ Limite honnête : un attaquant capable de LIRE le secret d'installation
//  (fichier userData) pourrait forger un HMAC valide. Cette couche stoppe
//  l'édition « ordinaire » du fichier d'état (le vecteur réaliste), pas un
//  attaquant local déterminé — la révocation reste vérifiée côté serveur.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')

const VERSION = 1

function canonicalBody(payload, hwid) {
  return JSON.stringify({ v: VERSION, payload, hwid })
}

function computeMac(secret, body) {
  return crypto.createHmac('sha256', String(secret)).update(body).digest('hex')
}

/** Sérialise `payload` en une enveloppe signée (chaîne JSON stockable). */
function sign(payload, secret, hwid) {
  const body = canonicalBody(payload, hwid)
  return JSON.stringify({ v: VERSION, payload, hwid, mac: computeMac(secret, body) })
}

/**
 * Vérifie une enveloppe signée. Renvoie `payload` si (et seulement si) le HMAC
 * est valide ET l'enveloppe est liée à CE hwid ; sinon `null`.
 */
function verify(raw, secret, hwid) {
  let obj
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || obj.v !== VERSION || typeof obj.mac !== 'string' || obj.hwid == null) return null
  if (obj.hwid !== hwid) return null // fichier copié d'une autre machine
  const expected = computeMac(secret, canonicalBody(obj.payload, obj.hwid))
  let a, b
  try { a = Buffer.from(obj.mac, 'hex'); b = Buffer.from(expected, 'hex') } catch { return null }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return obj.payload
}

module.exports = { sign, verify }

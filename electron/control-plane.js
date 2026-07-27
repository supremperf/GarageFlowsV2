'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Plan de contrôle côté client (helpers isolés & testables)
//
//  Regroupe la logique PURE (aucune dépendance Electron) partagée par le
//  processus principal :
//    • résolution du serveur de licences distant ;
//    • empreinte de crash IDENTIQUE au serveur (regroupement cohérent) ;
//    • détection de recul d'horloge (anti-contournement du mode hors ligne) ;
//    • file de crash bornée (offline-first).
//
//  Tout est en CommonJS car electron/main.js s'exécute en Node brut (non compilé).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')

/** Base HTTPS du serveur officiel (GF_LICENSE_SERVER), sans slash final. */
function resolveRemoteBase(env) {
  const s = (env && env.GF_LICENSE_SERVER) || ''
  const trimmed = String(s).trim().replace(/\/+$/, '')
  return trimmed || null
}

// ─── Empreinte de crash — DOIT rester identique à src/lib/crashes/service.ts ──
function normalizeCrashMessage(message) {
  return String(message || '')
    .replace(/0x[0-9a-fA-F]+/g, '0xADDR')
    .replace(/\b[0-9a-fA-F]{8,}\b/g, 'HEX')
    .replace(/\b\d+\b/g, 'N')
    .replace(/[A-Za-z]:\\[^\s'"]+|\/[^\s'"]+/g, 'PATH')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function topFrame(stack) {
  if (!stack) return ''
  for (const raw of String(stack).split('\n')) {
    const line = raw.trim()
    if (line.startsWith('at ')) {
      return line.replace(/:\d+:\d+/g, '').replace(/0x[0-9a-fA-F]+/g, '').slice(0, 200)
    }
  }
  return ''
}

function computeCrashFingerprint(message, stack, appVersion) {
  const verKey = String(appVersion || '').split('.').slice(0, 2).join('.')
  const basis = `${normalizeCrashMessage(message)}::${topFrame(stack)}::${verKey}`
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24)
}

// ─── Détection de recul d'horloge (clock tamper) ──────────────────────────────
/**
 * Renvoie true si l'horloge murale a reculé de plus que la tolérance depuis la
 * dernière référence de confiance — signe d'une tentative de contournement du
 * délai hors ligne (recul de la date Windows).
 *
 * @param {number|null} prevWall   dernier temps de confiance (ms epoch)
 * @param {number}      nowWall    temps mural courant (ms epoch)
 * @param {number}      skewMs     tolérance (ms)
 */
function detectClockRollback(prevWall, nowWall, skewMs) {
  if (!prevWall || !Number.isFinite(prevWall)) return false
  return nowWall < prevWall - Math.max(0, skewMs)
}

// ─── Vérification d'intégrité des mises à jour ────────────────────────────────
/**
 * Compare deux empreintes SHA-256 hexadécimales en temps constant (anti timing).
 * Renvoie false si l'une est absente/malformée — jamais d'exception.
 */
function sha256HexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const na = a.trim().toLowerCase()
  const nb = b.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(na) || !/^[0-9a-f]{64}$/.test(nb)) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(na, 'hex'), Buffer.from(nb, 'hex'))
  } catch {
    return false
  }
}

// ─── File de crash bornée (offline-first) ─────────────────────────────────────
/** Ajoute un élément en fin de file et borne la taille (garde les plus récents). */
function pushBounded(list, item, max) {
  const arr = Array.isArray(list) ? list.slice() : []
  arr.push(item)
  const cap = Math.max(1, max || 50)
  return arr.length > cap ? arr.slice(arr.length - cap) : arr
}

module.exports = {
  resolveRemoteBase,
  normalizeCrashMessage,
  topFrame,
  computeCrashFingerprint,
  detectClockRollback,
  sha256HexEqual,
  pushBounded,
}

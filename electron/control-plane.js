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

// Même autorité que la licence : une seule URL officielle compilée dans le
// binaire, importée depuis son module de référence pour qu'elles ne puissent
// pas diverger.
const { OFFICIAL_LICENSE_SERVER: OFFICIAL_CONTROL_PLANE } = require('./license-endpoint')

/**
 * Base HTTPS du plan de contrôle (crashs, notifications, accusés de réception).
 *
 * ─── Le défaut corrigé (GF31-AUD-043) ───────────────────────────────────────
 * Cette fonction ne lisait QUE `GF_LICENSE_SERVER`. Or une application packagée
 * n'embarque aucun `.env` : la variable est absente en production, la fonction
 * rendait `null`, et ses trois consommateurs sortaient **en silence**. Rapports
 * de crash, notifications et accusés de réception étaient donc morts sur
 * l'intégralité du parc installé — trois fonctionnalités livrées, consenties par
 * l'utilisateur, et sans le moindre effet ni le moindre signal.
 *
 * C'est mot pour mot le défaut que `license-endpoint.js` a été écrit pour
 * corriger sur l'autorité de licence (« une app packagée sans .env doit TOUJOURS
 * pouvoir joindre l'autorité distante »). Il subsistait ici.
 *
 * ─── La règle retenue ───────────────────────────────────────────────────────
 *  1. surcharge d'environnement explicite → elle fait foi (dev, staging, self-hosted) ;
 *  2. sinon, application PACKAGÉE → autorité officielle compilée dans le binaire ;
 *  3. sinon (développement sans configuration) → `null`, pour qu'un poste de
 *     développement n'envoie pas ses crashs de mise au point en production.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{ isPackaged?: boolean }} [opts]
 * @returns {string|null} base sans slash final
 */
function resolveRemoteBase(env, opts) {
  const s = (env && env.GF_LICENSE_SERVER) || ''
  const trimmed = String(s).trim().replace(/\/+$/, '')
  if (trimmed) {
    // En production packagée, une surcharge non-https est refusée (anti-downgrade),
    // exactement comme pour l'autorité de licence.
    if (opts && opts.isPackaged && !/^https:\/\//i.test(trimmed)) {
      return OFFICIAL_CONTROL_PLANE
    }
    return trimmed
  }
  return opts && opts.isPackaged ? OFFICIAL_CONTROL_PLANE : null
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

// ─── Redaction des rapports de crash (minimisation RGPD) ──────────────────────
/**
 * Nettoie une chaîne (message/stack/logs/breadcrumbs) AVANT envoi :
 *  - masque secrets/tokens/mots de passe/clés API/cookies/Authorization ;
 *  - masque les URLs de base de données (identifiants) ;
 *  - anonymise les chemins locaux contenant le nom d'utilisateur ;
 *  - masque les tokens de licence GF2 et les JWT.
 * Ne lève jamais. Renvoie "" pour une entrée vide.
 */
function redactSensitive(input) {
  if (input == null) return ''
  let s = String(input)

  // Chemins utilisateur Windows / *nix → neutralise le nom d'utilisateur.
  s = s.replace(/([A-Za-z]:\\Users\\)[^\\/\r\n"']+/gi, '$1<user>')
  s = s.replace(/(\/(?:home|Users))\/[^\/\r\n"']+/g, '$1/<user>')

  // URLs de connexion base de données avec identifiants.
  s = s.replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '$1://<redacted>')

  // En-têtes sensibles : masque toute la valeur jusqu'à la fin de ligne
  // (Authorization: Bearer … contient un espace, on ne doit pas s'arrêter avant).
  s = s.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]+/gi, '$1: <redacted>')
  // Guillemets/espaces/échappements et préfixes env (bornés à 64 caractères).
  // Une valeur citée tronquée est masquée jusqu’à la fin, pas laissée en clair.
  // Paires clé=valeur sensibles (mot de passe, token, clé API, secret…).
  s = s.replace(
    /\b((?:[a-z0-9_-]{1,64}[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|nextauth_secret|authorization|cookie|set-cookie|jwt|signature|private[_-]?key|gf_session))\b(["']?\s*[:=]\s*)("(?:\\.|\\$|[^"\\])*(?:"|$)|'(?:\\.|\\$|[^'\\])*(?:'|$)|[^\s,;"'}\]]+)/gi,
    (_match, key, separator, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : ''
      return `${key}${separator}${quote}<redacted>${quote}`
    },
  )

  // Bearer tokens.
  s = s.replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer <redacted>')

  // Tokens de licence GF2 (GF2.<h>.<p>.<s>).
  s = s.replace(/GF2\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, 'GF2.<redacted>')

  // JWT (xxx.yyy.zzz) génériques.
  s = s.replace(/\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '<jwt:redacted>')

  return s
}

/**
 * Applique la redaction à un rapport de crash complet et borne les tailles.
 * Liste blanche implicite : seuls les champs connus sont conservés.
 */
function sanitizeCrashReport(report) {
  const r = report || {}
  return {
    consent: true,
    licenseId: r.licenseId ?? null,
    // On ne transmet PAS le HWID brut : un hash court suffit au regroupement admin.
    hwid: r.hwid ? require('crypto').createHash('sha256').update(String(r.hwid)).digest('hex').slice(0, 16) : null,
    appVersion: r.appVersion ?? null,
    channel: r.channel ?? null,
    os: r.os ?? null,
    arch: r.arch ?? null,
    cpu: r.cpu ?? null,
    ramMb: typeof r.ramMb === 'number' ? r.ramMb : null,
    message: redactSensitive(r.message).slice(0, 2000),
    stack: r.stack ? redactSensitive(r.stack).slice(0, 20000) : null,
    breadcrumbs: r.breadcrumbs ? redactSensitive(r.breadcrumbs).slice(0, 10000) : null,
    logs: r.logs ? redactSensitive(r.logs).slice(0, 4000) : null,
    fatal: !!r.fatal,
    kind: r.kind ?? 'crash',
  }
}

module.exports = {
  resolveRemoteBase,
  normalizeCrashMessage,
  topFrame,
  computeCrashFingerprint,
  detectClockRollback,
  sha256HexEqual,
  pushBounded,
  redactSensitive,
  sanitizeCrashReport,
}

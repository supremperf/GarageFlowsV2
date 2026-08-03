/**
 * Redaction centralisée des données sensibles pour la JOURNALISATION.
 *
 * Objectif (Phase 15) : aucun log ne doit contenir mots de passe, secrets,
 * tokens complets, cookies, clés API, signatures, HWID complet, identifiants de
 * connexion base de données ni JWT. Toutes les entrées du logger passent par
 * `redactValue`. Ne lève jamais.
 *
 * Miroir volontaire de electron/control-plane.js:redactSensitive (contexte
 * Electron) — ici pour le serveur Next.js.
 */

/** Clés d'objet dont la VALEUR doit toujours être masquée. */
const SENSITIVE_KEY = /^(password|passwd|pwd|secret|.*secret|token|.*token|api[_-]?key|authorization|cookie|set-cookie|hwid|jwt|signature|private[_-]?key|nextauth_secret|gf_session)$/i

/** Masque les motifs sensibles dans une chaîne. */
export function redactString(input: string): string {
  let s = input

  // Chemins utilisateur → neutralise le nom d'utilisateur.
  s = s.replace(/([A-Za-z]:\\Users\\)[^\\/\r\n"']+/gi, '$1<user>')
  s = s.replace(/(\/(?:home|Users))\/[^/\r\n"']+/g, '$1/<user>')

  // URLs de connexion base de données avec identifiants.
  s = s.replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '$1://<redacted>')

  // Jetons de portail client dans un CHEMIN d'URL (mission §10) :
  //   /portal/<token>  et  /portal/quote/<token>  →  /portal[/quote]/[REDACTED]
  // On ne masque QUE les segments « jeton » (longs / de forme JWT ou base64url),
  // jamais les pages statiques (/portal/login, /portal/register, /portal/account).
  // Placé AVANT la règle JWT générique pour émettre exactement « [REDACTED] ».
  s = s.replace(
    /\/portal(\/quote)?\/(?:eyJ[A-Za-z0-9._-]+|[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){0,2})/g,
    '/portal$1/[REDACTED]',
  )

  // En-têtes sensibles (valeur jusqu'à la fin de ligne).
  s = s.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]+/gi, '$1: <redacted>')

  // Paires clé=valeur sensibles.
  s = s.replace(
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|nextauth_secret)\b\s*[:=]\s*[^\s,;"']+/gi,
    '$1=<redacted>',
  )

  // Bearer tokens.
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')

  // Tokens de licence GF2 et JWT.
  s = s.replace(/GF2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'GF2.<redacted>')
  s = s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt:redacted>')

  // HWID / SHA-256 (64 hex) → empreinte courte non réversible (12 premiers).
  s = s.replace(/\b[a-f0-9]{64}\b/gi, (m) => `${m.slice(0, 12)}…<redacted>`)

  return s
}

/** Redacte récursivement une valeur (chaîne, objet, tableau) pour les logs. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '<max-depth>'
  if (value == null) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined }
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '<redacted>' : redactValue(v, depth + 1)
    }
    return out
  }
  return String(value)
}

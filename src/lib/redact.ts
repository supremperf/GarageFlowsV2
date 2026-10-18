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
const SENSITIVE_KEY = /^(password|passwd|pwd|secret|.*secret|token|.*token|.*api[_-]?key|.*password|.*passwd|.*pwd|authorization|cookie|set-cookie|hwid|jwt|signature|private[_-]?key|nextauth_secret|gf_session)$/i

/** Masque les motifs sensibles dans une chaîne. */
export function redactString(input: string): string {
  let s = input

  // Chemins utilisateur → neutralise le nom d'utilisateur.
  s = s.replace(/([A-Za-z]:\\Users\\)[^\\/\r\n"']+/gi, '$1<user>')
  s = s.replace(/(\/(?:home|Users))\/[^/\r\n"']+/g, '$1/<user>')

  // URLs de connexion base de données avec identifiants.
  s = s.replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '$1://<redacted>')

  // Jetons de portail client dans un CHEMIN d'URL (mission §10) :
  //   /clients/<token>  et  /clients/quote/<token>  →  /clients[/quote]/[REDACTED]
  // On ne masque QUE les segments « jeton » (longs / de forme JWT ou base64url),
  // jamais les pages statiques (/clients/login, /clients/register, /clients/account).
  // Placé AVANT la règle JWT générique pour émettre exactement « [REDACTED] ».
  //
  // L'ancien préfixe `/portal` reste couvert : les journaux déjà écrits, et les
  // requêtes qui arrivent encore dessus avant la redirection permanente,
  // contiennent des jetons tout aussi valides.
  s = s.replace(
    /\/(clients|portal)(\/quote)?\/(?:eyJ[A-Za-z0-9._-]+|[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){0,2})/g,
    '/$1$2/[REDACTED]',
  )

  // En-têtes sensibles (valeur jusqu'à la fin de ligne).
  s = s.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]+/gi, '$1: <redacted>')

  // Guillemets/espaces/échappements et préfixes env (bornés à 64 caractères).
  // Une valeur citée tronquée est masquée jusqu’à la fin, pas laissée en clair.
  // Paires clé=valeur sensibles.
  s = s.replace(
    /\b((?:[a-z0-9_-]{1,64}[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|nextauth_secret|authorization|cookie|set-cookie|jwt|signature|private[_-]?key|gf_session))\b(["']?\s*[:=]\s*)("(?:\\.|\\$|[^"\\])*(?:"|$)|'(?:\\.|\\$|[^'\\])*(?:'|$)|[^\s,;"'}\]]+)/gi,
    (_match, key, separator, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : ''
      return `${key}${separator}${quote}<redacted>${quote}`
    },
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

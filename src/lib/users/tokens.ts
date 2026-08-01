/**
 * Jetons de récupération de compte — à usage unique, HACHÉS au repos.
 *
 * Un jeton en clair (aléatoire, 256 bits) est renvoyé UNE fois à l'appelant
 * (pour l'envoyer par e-mail au destinataire) ; la base ne stocke que son
 * empreinte SHA-256. Une fuite de la base ne permet donc pas de réutiliser un
 * jeton. Le jeton n'est JAMAIS journalisé.
 *
 * Types : `password_reset` (mot de passe oublié), `email_verify` (vérification
 * d'adresse), `invite` (invitation d'un employé à définir son mot de passe).
 */
import crypto from 'crypto'

export type AuthTokenType = 'password_reset' | 'email_verify' | 'invite'

/** Durées de validité par type (ms). */
export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  password_reset: 60 * 60 * 1000,        // 1 heure
  email_verify: 24 * 60 * 60 * 1000,     // 24 heures
  invite: 7 * 24 * 60 * 60 * 1000,       // 7 jours
}

/** Empreinte SHA-256 (hex) d'un jeton — la SEULE forme stockée. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Génère un jeton aléatoire (clair) et son empreinte à stocker.
 * `token` part par e-mail au destinataire ; seul `tokenHash` va en base.
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

/** Date d'expiration pour un type de jeton, calculée depuis `now`. */
export function tokenExpiry(type: AuthTokenType, now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_MS[type])
}

/** Vrai si un jeton stocké est encore utilisable (non consommé, non expiré). */
export function isTokenUsable(
  record: { usedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  if (record.usedAt) return false
  return record.expiresAt.getTime() > now.getTime()
}

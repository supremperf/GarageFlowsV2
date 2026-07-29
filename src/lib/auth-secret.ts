/**
 * Secret unique de signature/vérification des JWT (session gf_session,
 * licence admin, portail). Lecture CENTRALISÉE pour éviter toute divergence
 * entre le middleware et les routes API (bug historique : fallbacks différents).
 *
 * Edge-safe : ne lit que process.env + TextEncoder, aucune API Node.
 * Aucun secret de repli codé en dur : en l'absence de NEXTAUTH_SECRET la
 * fonction échoue explicitement (refus de forger/vérifier un jeton avec un
 * secret prévisible).
 */
export function authSecret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'Configuration invalide : NEXTAUTH_SECRET est absent ou trop court. ' +
        'Définissez une valeur aléatoire (openssl rand -base64 32).'
    )
  }
  return s
}

export function authSecretKey(): Uint8Array {
  return new TextEncoder().encode(authSecret())
}

/**
 * Décision PURE de revalidation de session (utilisée par le callback JWT de
 * next-auth). Séparée du callback pour être testable sans base ni next-auth.
 *
 * Un JWT next-auth est autonome (30 j) : sans revalidation, un employé suspendu
 * ou licencié garderait l'accès jusqu'à expiration. On recharge donc l'état du
 * compte à chaque requête et on révoque si :
 *   - le compte n'existe plus ;
 *   - son statut n'est pas « active » (suspendu / invité) ;
 *   - son `sessionEpoch` a été incrémenté (révocation explicite / reset).
 *
 * Le rôle courant est renvoyé pour propager un changement de rôle SANS
 * reconnexion. En cas d'erreur base (disponibilité), l'appelant conserve le
 * token tel quel (fail-open sur la disponibilité, fail-closed sur les décisions
 * définitives ci-dessus).
 */

export interface RevalidationInput {
  /** Compte rechargé depuis la base, ou null si introuvable. */
  dbUser: { status: string; sessionEpoch: number; role: string } | null
  /** Epoch enregistré dans le token à l'émission. */
  tokenEpoch: number | undefined
}

export interface RevalidationDecision {
  revoked: boolean
  role?: string
  reason?: 'not_found' | 'inactive' | 'epoch_mismatch'
}

export function sessionRevalidationDecision(input: RevalidationInput): RevalidationDecision {
  const { dbUser, tokenEpoch } = input
  if (!dbUser) return { revoked: true, reason: 'not_found' }
  if (dbUser.status !== 'active') return { revoked: true, reason: 'inactive' }
  // Un token sans epoch (émis avant la fonctionnalité) est accepté tant que le
  // compte est actif ; sinon l'epoch doit correspondre exactement.
  if (typeof tokenEpoch === 'number' && tokenEpoch !== dbUser.sessionEpoch) {
    return { revoked: true, reason: 'epoch_mismatch' }
  }
  return { revoked: false, role: dbUser.role }
}

/**
 * Machine à états des LICENCES — pure, testable, appliquée aux frontières.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * Le cycle de vie des APPAREILS avait sa table de transitions
 * (`canTransitionDevice`, src/lib/license/devices.ts). Le cycle de vie des
 * LICENCES n'en avait aucune : `PATCH /api/admin/licenses/[id]` écrivait
 * `data.status = body.status` tel quel, sans validation d'exécution ni journal.
 * Trois conséquences démontrées :
 *
 *  1. `revoked → active` était une écriture de champ ordinaire, impossible à
 *     distinguer d'un changement de libellé. Aucune trace : ni acteur, ni motif,
 *     ni horodatage. La révocation n'était donc pas un état terminal.
 *
 *  2. `status` n'était typé qu'à la COMPILATION. `req.json()` ne valide rien à
 *     l'exécution : `{"status":"Revoked"}` (majuscule), `{"status":"revoked "}`
 *     (espace final) ou n'importe quelle chaîne était persistée telle quelle —
 *     puis scellée par un `recordMac` recalculé, donc parfaitement « intègre ».
 *     Or tous les points de contrôle comparent par ÉGALITÉ STRICTE
 *     (`record.status === 'revoked'`) : une valeur hors énumération ne
 *     correspond à aucun refus et retombe sur la branche « still active » de
 *     `/api/license/check`, qui répond `allowed:true, status:'active'`. Une
 *     licence affichée « Revoked » dans l'admin accordait l'accès complet.
 *
 *  3. `DELETE /api/admin/licenses/[id]` supprimait la ligne. Or
 *     `/api/license/activate` interprète l'ABSENCE de ligne comme un premier
 *     usage et la recrée avec `status: 'active'`. Supprimer une licence révoquée
 *     la ressuscitait donc en ACTIVE au prochain démarrage du poste — c'est
 *     exactement pour l'éviter que `/api/admin/licenses/revoke-by-key` pose une
 *     pierre tombale sur les licences pas encore enregistrées ; le DELETE la
 *     retirait.
 *
 * RÈGLES
 * ------
 *  - `revoked` est TERMINAL. Il n'en sort que par une action d'administration
 *    EXPLICITE (drapeau de confirmation dédié + motif obligatoire), jamais par
 *    une écriture de champ ordinaire, jamais par un heartbeat, une activation,
 *    une synchronisation, un redémarrage ou une suppression de ligne.
 *  - `suspended → active` est une décision administrative légitime, mais reste
 *    JOURNALISÉE (acteur, horodatage, motif éventuel).
 *  - `expired` est DÉRIVÉ de `expiryAt` : il se constate, il ne se pose pas.
 *  - Toute valeur hors énumération est refusée à l'entrée, jamais persistée.
 */

/** États canoniques d'une licence. */
export const LICENSE_STATES = ['active', 'suspended', 'revoked', 'expired'] as const
export type LicenseState = (typeof LICENSE_STATES)[number]

/**
 * États réellement POSITIONNABLES par un administrateur.
 * `expired` en est exclu : il découle de `expiryAt`. L'accepter en écriture
 * aurait créé un second mécanisme d'expiration, divergent du premier.
 */
export const SETTABLE_LICENSE_STATES = ['active', 'suspended', 'revoked'] as const
export type SettableLicenseState = (typeof SETTABLE_LICENSE_STATES)[number]

/**
 * Garde d'exécution : la valeur est-elle EXACTEMENT un état positionnable ?
 *
 * Volontairement STRICTE — ni `trim()`, ni `toLowerCase()`. Accepter
 * `' Revoked '` reviendrait à accepter que deux écritures différentes désignent
 * le même état, alors que toute la chaîne de contrôle compare par égalité
 * stricte. Mieux vaut un 400 explicite qu'une normalisation silencieuse.
 */
export function isSettableLicenseState(value: unknown): value is SettableLicenseState {
  return typeof value === 'string' && (SETTABLE_LICENSE_STATES as readonly string[]).includes(value)
}

/** La valeur est-elle un état canonique (y compris `expired`) ? */
export function isLicenseState(value: unknown): value is LicenseState {
  return typeof value === 'string' && (LICENSE_STATES as readonly string[]).includes(value)
}

/** Résultat d'une demande de transition. */
export type TransitionVerdict =
  | { ok: true; kind: 'noop' | 'normal' | 'reactivation' }
  | { ok: false; code: 'INVALID_STATUS' | 'REVOKED_IS_FINAL' | 'REACTIVATION_REQUIRES_CONFIRMATION' | 'UNKNOWN_CURRENT_STATE'; message: string }

export interface TransitionRequest {
  /** État courant lu en base (peut être une valeur historique inattendue). */
  from: unknown
  /** État demandé. */
  to: unknown
  /**
   * L'appelant a-t-il explicitement demandé une RÉACTIVATION d'une licence
   * révoquée ? Un `PATCH {status:'active'}` ordinaire ne suffit pas : il faut
   * un geste dédié, pour que réactiver ne puisse jamais être un effet de bord.
   */
  confirmReactivation?: boolean
  /** Motif — obligatoire pour sortir de `revoked`. */
  reason?: unknown
}

/** Longueur minimale d'un motif de réactivation (un motif vide n'en est pas un). */
export const MIN_REASON_LENGTH = 5

/**
 * Le motif fourni est-il exploitable ? (chaîne non vide après retrait des
 * espaces, d'au moins MIN_REASON_LENGTH caractères)
 */
export function isUsableReason(reason: unknown): reason is string {
  return typeof reason === 'string' && reason.trim().length >= MIN_REASON_LENGTH
}

/**
 * Décide si une transition de licence est autorisée.
 *
 * Fonction PURE : aucune lecture de base, aucun effet de bord. C'est ce qui la
 * rend éprouvable exhaustivement (voir state-machine.test.ts, qui balaie le
 * produit cartésien des états).
 */
export function canTransitionLicense(req: TransitionRequest): TransitionVerdict {
  const { from, to, confirmReactivation, reason } = req

  if (!isSettableLicenseState(to)) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: `Statut invalide. Valeurs acceptées : ${SETTABLE_LICENSE_STATES.join(', ')}.`,
    }
  }

  // L'état COURANT peut être une valeur héritée ou corrompue (c'est précisément
  // ce que l'absence de validation d'exécution a pu produire). On refuse de
  // raisonner dessus : seule une remise en conformité explicite est permise, et
  // uniquement vers un état de blocage — jamais vers `active`.
  if (!isLicenseState(from)) {
    if (to === 'active') {
      return {
        ok: false,
        code: 'UNKNOWN_CURRENT_STATE',
        message: 'État courant de la licence non reconnu : activation refusée. Corrigez vers « suspended » ou « revoked ».',
      }
    }
    return { ok: true, kind: 'normal' }
  }

  if (from === to) return { ok: true, kind: 'noop' }

  // ── `revoked` est terminal ────────────────────────────────────────────────
  if (from === 'revoked') {
    if (to !== 'active') {
      // revoked → suspended n'a aucun sens métier : ce serait un ADOUCISSEMENT
      // de la sanction sans le contrôle exigé pour une réactivation.
      return {
        ok: false,
        code: 'REVOKED_IS_FINAL',
        message: 'Une licence révoquée ne peut pas être suspendue. Seule une réactivation administrative explicite est possible.',
      }
    }
    if (confirmReactivation !== true || !isUsableReason(reason)) {
      return {
        ok: false,
        code: 'REACTIVATION_REQUIRES_CONFIRMATION',
        message: `Réactiver une licence révoquée exige une confirmation explicite et un motif d'au moins ${MIN_REASON_LENGTH} caractères.`,
      }
    }
    return { ok: true, kind: 'reactivation' }
  }

  // `expired` n'est jamais l'état COURANT en base (il est dérivé) ; s'il y
  // figure malgré tout, on le traite comme un blocage ordinaire, réactivable
  // par l'admin (le renouvellement passe par `expiryAt`, pas par `status`).
  return { ok: true, kind: 'normal' }
}

/**
 * Statut EFFECTIF d'une licence : l'expiration prime sur le statut stocké, mais
 * ne masque jamais une révocation ou une suspension.
 *
 * Ordre délibéré : `revoked` > `suspended` > `expired` > `active`. Une licence
 * révoquée ET expirée doit être annoncée « révoquée » — c'est la cause qui
 * appelle une action, et l'inverse laisserait croire qu'un renouvellement suffit.
 */
export function effectiveLicenseStatus(
  record: { status: string; expiryAt: Date | string | number },
  now: Date = new Date(),
): LicenseState | 'unknown' {
  if (record.status === 'revoked') return 'revoked'
  if (record.status === 'suspended') return 'suspended'
  const expiry = record.expiryAt instanceof Date ? record.expiryAt : new Date(record.expiryAt)
  if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) return 'expired'
  if (record.status === 'active') return 'active'
  // Toute autre valeur est INCONNUE — surtout pas « active » par défaut.
  return 'unknown'
}

/**
 * Une licence dans cet état peut-elle ouvrir une session / valider un heartbeat ?
 * Défaut sûr : tout ce qui n'est pas explicitement `active` est refusé.
 */
export function licenseGrantsAccess(
  record: { status: string; expiryAt: Date | string | number },
  now: Date = new Date(),
): boolean {
  return effectiveLicenseStatus(record, now) === 'active'
}

/** Action d'audit correspondant à une transition (journal du cycle de vie). */
export function auditActionFor(to: SettableLicenseState, kind: 'noop' | 'normal' | 'reactivation'): string {
  if (kind === 'reactivation') return 'license_reactivated'
  return `license_${to}` // license_active | license_suspended | license_revoked
}

/**
 * Cycle de vie des comptes employés — règles d'autorisation et garde-fous PURS
 * (aucun accès base). Testables isolément et réutilisés par le service et les
 * routes API. Toute décision sensible est validée CÔTÉ SERVEUR via ces règles.
 */

export const ROLES = ['OWNER', 'MANAGER', 'MECHANIC', 'RECEPTIONIST'] as const
export type Role = (typeof ROLES)[number]

export type UserStatus = 'active' | 'suspended' | 'invited'

export function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role)
}

/** Seul le propriétaire gère les comptes (invitation, suspension, rôles, transfert). */
export function canManageEmployees(actorRole: string): boolean {
  return actorRole === 'OWNER'
}

export interface EmployeeLike {
  id: string
  role: string
  status: string
}

/** Nombre de propriétaires ACTIFS dans une liste d'employés. */
export function activeOwnerCount(users: readonly EmployeeLike[]): number {
  return users.filter(u => u.role === 'OWNER' && u.status === 'active').length
}

export interface GuardResult { ok: boolean; error?: string }
const ok: GuardResult = { ok: true }
const deny = (error: string): GuardResult => ({ ok: false, error })

/**
 * Empêche de retirer le DERNIER propriétaire actif (suspension, rétrogradation,
 * suppression). `users` = tous les employés du garage ; `targetId` = la cible ;
 * `wouldRemainOwnerActive` = l'état de la cible APRÈS l'opération.
 */
export function assertNotLastOwner(
  users: readonly EmployeeLike[],
  targetId: string,
  wouldRemainOwnerActive: boolean,
): GuardResult {
  const target = users.find(u => u.id === targetId)
  if (!target) return deny('Employé introuvable')
  const wasActiveOwner = target.role === 'OWNER' && target.status === 'active'
  if (!wasActiveOwner || wouldRemainOwnerActive) return ok
  // La cible cesse d'être propriétaire actif → au moins un AUTRE doit rester.
  const others = users.filter(u => u.id !== targetId)
  return activeOwnerCount(others) >= 1 ? ok : deny('Impossible : au moins un propriétaire actif doit subsister.')
}

/** Valide une suspension : acteur habilité, pas soi-même, pas le dernier propriétaire. */
export function validateSuspend(actor: { id: string; role: string }, users: readonly EmployeeLike[], targetId: string): GuardResult {
  if (!canManageEmployees(actor.role)) return deny('Réservé au propriétaire')
  if (actor.id === targetId) return deny('Vous ne pouvez pas suspendre votre propre compte.')
  return assertNotLastOwner(users, targetId, /* wouldRemainOwnerActive */ false)
}

/** Valide un changement de rôle : acteur habilité, rôle valide, dernier propriétaire protégé. */
export function validateRoleChange(
  actor: { id: string; role: string },
  users: readonly EmployeeLike[],
  targetId: string,
  newRole: string,
): GuardResult {
  if (!canManageEmployees(actor.role)) return deny('Réservé au propriétaire')
  if (!isValidRole(newRole)) return deny('Rôle invalide')
  const target = users.find(u => u.id === targetId)
  if (!target) return deny('Employé introuvable')
  // Si on rétrograde un propriétaire (nouveau rôle != OWNER), il reste propriétaire ? non.
  const remainsOwnerActive = newRole === 'OWNER' && target.status === 'active'
  return assertNotLastOwner(users, targetId, remainsOwnerActive)
}

/** Valide une révocation de sessions (acteur habilité ; s'applique à tout compte du garage). */
export function validateRevokeSessions(actor: { id: string; role: string }): GuardResult {
  return canManageEmployees(actor.role) ? ok : deny('Réservé au propriétaire')
}

/** Valide un transfert de propriété : acteur propriétaire, cible active et distincte. */
export function validateTransferOwnership(
  actor: { id: string; role: string },
  users: readonly EmployeeLike[],
  targetId: string,
): GuardResult {
  if (!canManageEmployees(actor.role)) return deny('Réservé au propriétaire')
  if (actor.id === targetId) return deny('La cible du transfert doit être un autre employé.')
  const target = users.find(u => u.id === targetId)
  if (!target) return deny('Employé introuvable')
  if (target.status !== 'active') return deny('Le nouveau propriétaire doit être un compte actif.')
  return ok
}

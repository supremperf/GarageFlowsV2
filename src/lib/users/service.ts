/**
 * Service comptes employés + récupération de compte (persistance Prisma).
 *
 * Toutes les opérations sensibles sont ISOLÉES par garageId et appliquent les
 * garde-fous PURS de `lifecycle.ts` (autorisation côté serveur, protection du
 * dernier propriétaire). Les jetons sont HACHÉS (voir `tokens.ts`). Les mots de
 * passe sont hachés en bcrypt (coût 12, comme le reste de l'app). Aucun secret
 * ni mot de passe n'est renvoyé ni journalisé.
 */
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { generateToken, hashToken, tokenExpiry, isTokenUsable, type AuthTokenType } from './tokens'
import {
  validateSuspend, validateRoleChange, validateRevokeSessions, validateTransferOwnership,
  canManageEmployees, isValidRole, type EmployeeLike, type GuardResult,
} from './lifecycle'

const BCRYPT_ROUNDS = 12
/** Hash bcrypt inutilisable (un compte invité ne peut pas se connecter avant d'accepter). */
const UNUSABLE_PASSWORD = '!invited:no-login'

export interface Actor { id: string; role: string; garageId: string }

/** Employés d'un garage, forme minimale pour les garde-fous. */
function garageEmployees(garageId: string): Promise<EmployeeLike[]> {
  return prisma.user.findMany({
    where: { garageId },
    select: { id: true, role: true, status: true },
  })
}

// ── Récupération de compte : mot de passe oublié ────────────────────────────

export interface IssuedToken { userId: string; garageId: string; email: string; name: string; token: string }

/**
 * Émet un jeton de réinitialisation pour l'e-mail donné (dans le garage). Ne
 * révèle jamais l'existence du compte : renvoie null silencieusement si l'e-mail
 * est inconnu ou le compte inactif. Le jeton EN CLAIR est renvoyé à l'appelant
 * (route) pour envoi par e-mail ; seule son empreinte est stockée.
 */
export async function issuePasswordReset(email: string, now: Date = new Date()): Promise<IssuedToken | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || user.status !== 'active') return null
  return createToken('password_reset', user, now)
}

async function createToken(
  type: AuthTokenType,
  user: { id: string; garageId: string; email: string; name: string },
  now: Date,
): Promise<IssuedToken> {
  const { token, tokenHash } = generateToken()
  await prisma.authToken.create({
    data: { userId: user.id, type, tokenHash, expiresAt: tokenExpiry(type, now) },
  })
  return { userId: user.id, garageId: user.garageId, email: user.email, name: user.name, token }
}

/** Consomme un jeton (usage unique) et applique l'action, dans une transaction. */
async function consumeToken<T>(
  type: AuthTokenType,
  token: string,
  apply: (tx: typeof prisma, userId: string) => Promise<T>,
  now: Date = new Date(),
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const tokenHash = hashToken(token)
  const record = await prisma.authToken.findUnique({ where: { tokenHash } })
  if (!record || record.type !== type || !isTokenUsable(record, now)) {
    return { ok: false, error: 'Lien invalide ou expiré.' }
  }
  const result = await prisma.$transaction(async (tx) => {
    // Marque consommé AVANT l'action (usage unique strict, même en cas de rejeu concurrent).
    const claim = await tx.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    })
    if (claim.count !== 1) throw new Error('already_used')
    return apply(tx as unknown as typeof prisma, record.userId)
  }).catch((e) => (e instanceof Error && e.message === 'already_used' ? null : Promise.reject(e)))
  if (result === null) return { ok: false, error: 'Lien déjà utilisé.' }
  return { ok: true, result }
}

/** Réinitialise le mot de passe via un jeton ; révoque toutes les sessions existantes. */
export async function confirmPasswordReset(token: string, newPassword: string, now: Date = new Date()) {
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  return consumeToken('password_reset', token, async (tx, userId) => {
    await tx.user.update({
      where: { id: userId },
      // Bump de sessionEpoch → invalide les JWT émis avant la réinitialisation.
      data: { password: hashed, sessionEpoch: { increment: 1 } },
    })
    return { userId }
  }, now)
}

// ── Vérification d'e-mail ────────────────────────────────────────────────────

export async function issueEmailVerification(userId: string, now: Date = new Date()): Promise<IssuedToken | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null
  return createToken('email_verify', user, now)
}

export async function confirmEmailVerification(token: string, now: Date = new Date()) {
  return consumeToken('email_verify', token, async (tx, userId) => {
    await tx.user.update({ where: { id: userId }, data: { emailVerified: true } })
    return { userId }
  }, now)
}

// ── Cycle de vie employé (propriétaire uniquement) ──────────────────────────

/** Liste les employés d'un garage (jamais le mot de passe). */
export function listEmployees(garageId: string) {
  return prisma.user.findMany({
    where: { garageId },
    select: {
      id: true, name: true, email: true, role: true, status: true,
      emailVerified: true, lastLoginAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

export interface InviteInput { name: string; email: string; role: string }

/** Invite un employé : crée un compte « invited » + un jeton d'invitation (clair renvoyé). */
export async function inviteEmployee(actor: Actor, input: InviteInput, now: Date = new Date()) {
  if (!canManageEmployees(actor.role)) return { ok: false as const, error: 'Réservé au propriétaire' }
  const role = isValidRole(input.role) && input.role !== 'OWNER' ? input.role : 'RECEPTIONIST'
  const email = input.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return { ok: false as const, error: 'Email déjà utilisé' }

  const user = await prisma.user.create({
    data: {
      name: input.name, email, password: UNUSABLE_PASSWORD, role,
      status: 'invited', garageId: actor.garageId,
    },
  })
  const issued = await createToken('invite', user, now)
  return { ok: true as const, userId: user.id, token: issued.token, email }
}

/** Accepte une invitation : définit le mot de passe, active le compte, vérifie l'e-mail. */
export async function acceptInvite(token: string, password: string, now: Date = new Date()) {
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  return consumeToken('invite', token, async (tx, userId) => {
    await tx.user.update({
      where: { id: userId },
      data: { password: hashed, status: 'active', emailVerified: true, sessionEpoch: { increment: 1 } },
    })
    return { userId }
  }, now)
}

async function guardedGarageOp(actor: Actor, targetId: string, guard: (users: EmployeeLike[]) => GuardResult) {
  if (!canManageEmployees(actor.role)) return { ok: false as const, error: 'Réservé au propriétaire' }
  // Isolation : la cible DOIT appartenir au garage de l'acteur.
  const target = await prisma.user.findFirst({ where: { id: targetId, garageId: actor.garageId } })
  if (!target) return { ok: false as const, error: 'Employé introuvable' }
  const users = await garageEmployees(actor.garageId)
  const g = guard(users)
  if (!g.ok) return { ok: false as const, error: g.error! }
  return { ok: true as const, target }
}

/** Suspend un employé et révoque ses sessions (dernier propriétaire protégé). */
export async function suspendEmployee(actor: Actor, targetId: string) {
  const pre = await guardedGarageOp(actor, targetId, (users) => validateSuspend(actor, users, targetId))
  if (!pre.ok) return pre
  await prisma.user.update({
    where: { id: targetId },
    data: { status: 'suspended', sessionEpoch: { increment: 1 } },
  })
  return { ok: true as const }
}

/** Réactive un employé suspendu. */
export async function reactivateEmployee(actor: Actor, targetId: string) {
  if (!canManageEmployees(actor.role)) return { ok: false as const, error: 'Réservé au propriétaire' }
  const target = await prisma.user.findFirst({ where: { id: targetId, garageId: actor.garageId } })
  if (!target) return { ok: false as const, error: 'Employé introuvable' }
  await prisma.user.update({ where: { id: targetId }, data: { status: 'active' } })
  return { ok: true as const }
}

/** Change le rôle d'un employé (dernier propriétaire protégé). */
export async function changeRole(actor: Actor, targetId: string, newRole: string) {
  const pre = await guardedGarageOp(actor, targetId, (users) => validateRoleChange(actor, users, targetId, newRole))
  if (!pre.ok) return pre
  await prisma.user.update({ where: { id: targetId }, data: { role: newRole } })
  return { ok: true as const }
}

/** Révoque toutes les sessions d'un employé (incrémente sessionEpoch). */
export async function revokeSessions(actor: Actor, targetId: string) {
  if (!validateRevokeSessions(actor).ok) return { ok: false as const, error: 'Réservé au propriétaire' }
  const target = await prisma.user.findFirst({ where: { id: targetId, garageId: actor.garageId } })
  if (!target) return { ok: false as const, error: 'Employé introuvable' }
  await prisma.user.update({ where: { id: targetId }, data: { sessionEpoch: { increment: 1 } } })
  return { ok: true as const }
}

/**
 * Transfert de propriété : la cible devient OWNER, l'acteur devient MANAGER —
 * garantit qu'au moins un propriétaire actif subsiste. Transaction atomique.
 */
export async function transferOwnership(actor: Actor, targetId: string) {
  const pre = await guardedGarageOp(actor, targetId, (users) => validateTransferOwnership(actor, users, targetId))
  if (!pre.ok) return pre
  await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { role: 'OWNER' } }),
    prisma.user.update({ where: { id: actor.id }, data: { role: 'MANAGER' } }),
  ])
  return { ok: true as const }
}

/**
 * Service abonnement (persistance Prisma) — décisions d'accès CÔTÉ SERVEUR.
 *
 * Lit l'état d'abonnement d'un garage et applique la logique pure de
 * `subscription.ts`. L'`upsert` reflète l'état poussé par le facturier externe
 * (aucun paiement pris ici). Tout est scopé par garageId.
 */
import { prisma } from '@/lib/db'
import {
  decideAccess, statusFromExternal, type AccessDecision, type SubscriptionState, type SubscriptionStatus,
} from './subscription'

/** Lit l'état d'abonnement d'un garage (ou null si aucun). */
export async function getSubscriptionState(garageId: string): Promise<SubscriptionState | null> {
  const s = await prisma.subscription.findUnique({ where: { garageId } })
  if (!s) return null
  return {
    status: s.status as SubscriptionStatus,
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    graceEndsAt: s.graceEndsAt,
  }
}

/** Décision d'accès serveur pour un garage. */
export async function getAccess(garageId: string, now: Date = new Date()): Promise<AccessDecision> {
  return decideAccess(await getSubscriptionState(garageId), now)
}

export interface ExternalSubscriptionInput {
  externalStatus: string
  plan?: string
  externalCustomerId?: string | null
  externalSubscriptionId?: string | null
  seats?: number
  trialEndsAt?: Date | null
  currentPeriodEnd?: Date | null
  graceEndsAt?: Date | null
  cancelAt?: Date | null
  canceledAt?: Date | null
}

/**
 * Upsert de l'abonnement d'un garage à partir d'un état poussé par le facturier
 * externe. Le statut externe est traduit prudemment (`statusFromExternal`).
 * Idempotent sur `garageId` (une seule ligne par garage).
 */
export async function upsertFromExternal(garageId: string, input: ExternalSubscriptionInput) {
  const status = statusFromExternal(input.externalStatus)
  const data = {
    status,
    plan: input.plan ?? undefined,
    externalCustomerId: input.externalCustomerId ?? undefined,
    externalSubscriptionId: input.externalSubscriptionId ?? undefined,
    seats: input.seats ?? undefined,
    trialEndsAt: input.trialEndsAt ?? undefined,
    currentPeriodEnd: input.currentPeriodEnd ?? undefined,
    graceEndsAt: input.graceEndsAt ?? undefined,
    cancelAt: input.cancelAt ?? undefined,
    canceledAt: input.canceledAt ?? undefined,
  }
  return prisma.subscription.upsert({
    where: { garageId },
    create: { garageId, ...data, status },
    update: data,
  })
}

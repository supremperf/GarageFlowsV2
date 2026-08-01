/**
 * Décisions d'accès à l'abonnement — logique PURE (aucune base), testable.
 *
 * GarageFlow ne prend AUCUN paiement : un facturier EXTERNE (Stripe, etc.) gère
 * les paiements et pousse l'état de l'abonnement ; on le persiste puis on décide
 * l'accès CÔTÉ SERVEUR à partir de l'état + de l'instant courant. La décision ne
 * fait jamais confiance à une valeur figée : elle recalcule le statut EFFECTIF à
 * partir des échéances (fin d'essai, fin de période, fin de grâce).
 *
 * États : trial | active | grace | suspended | cancelled.
 */

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'grace', 'suspended', 'cancelled'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export interface SubscriptionState {
  status: SubscriptionStatus
  trialEndsAt?: Date | null
  currentPeriodEnd?: Date | null
  graceEndsAt?: Date | null
}

export interface AccessDecision {
  allowed: boolean
  effectiveStatus: SubscriptionStatus | 'none'
  reason: string
}

function after(now: Date, d?: Date | null): boolean {
  return d != null && now.getTime() > d.getTime()
}

/**
 * Statut EFFECTIF recalculé depuis l'état stocké + les échéances. Un essai ou
 * une période échus basculent automatiquement (essai→suspended, active→grace
 * puis suspended, grace→suspended) SANS attendre une mise à jour externe.
 */
export function effectiveStatus(sub: SubscriptionState, now: Date): SubscriptionStatus {
  switch (sub.status) {
    case 'trial':
      return after(now, sub.trialEndsAt) ? 'suspended' : 'trial'
    case 'active':
      if (!after(now, sub.currentPeriodEnd)) return 'active'
      // Période échue : grâce si une fenêtre de grâce court encore, sinon suspendu.
      return sub.graceEndsAt && !after(now, sub.graceEndsAt) ? 'grace' : 'suspended'
    case 'grace':
      return after(now, sub.graceEndsAt) ? 'suspended' : 'grace'
    case 'suspended':
      return 'suspended'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'suspended'
  }
}

/** Décision d'accès serveur : essai et grâce donnent accès ; suspendu/annulé non. */
export function decideAccess(sub: SubscriptionState | null | undefined, now: Date = new Date()): AccessDecision {
  if (!sub) return { allowed: false, effectiveStatus: 'none', reason: 'Aucun abonnement actif.' }
  const eff = effectiveStatus(sub, now)
  switch (eff) {
    case 'trial':   return { allowed: true, effectiveStatus: eff, reason: 'Période d’essai en cours.' }
    case 'active':  return { allowed: true, effectiveStatus: eff, reason: 'Abonnement actif.' }
    case 'grace':   return { allowed: true, effectiveStatus: eff, reason: 'Paiement en retard — période de grâce.' }
    case 'suspended': return { allowed: false, effectiveStatus: eff, reason: 'Abonnement suspendu (essai/période/grâce échus).' }
    case 'cancelled': return { allowed: false, effectiveStatus: eff, reason: 'Abonnement annulé.' }
    default: return { allowed: false, effectiveStatus: 'suspended', reason: 'Statut inconnu — accès refusé par défaut.' }
  }
}

/** Vrai si l'accès est autorisé (raccourci). */
export function isAccessAllowed(sub: SubscriptionState | null | undefined, now: Date = new Date()): boolean {
  return decideAccess(sub, now).allowed
}

/**
 * Traduit un statut reçu du facturier externe vers un statut interne. Tout
 * statut inconnu est mappé prudemment sur « suspended » (fail-closed).
 */
export function statusFromExternal(external: string): SubscriptionStatus {
  const s = external.trim().toLowerCase()
  switch (s) {
    case 'trialing': case 'trial': return 'trial'
    case 'active': case 'paid': return 'active'
    case 'past_due': case 'unpaid': return 'grace'
    case 'paused': case 'incomplete': case 'incomplete_expired': return 'suspended'
    case 'canceled': case 'cancelled': return 'cancelled'
    default: return 'suspended'
  }
}

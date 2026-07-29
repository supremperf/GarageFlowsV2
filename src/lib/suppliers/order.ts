/**
 * Purchase-order lifecycle — an explicit, guarded state machine.
 *
 *   draft ─▶ sent ─▶ confirmed ─▶ received ─▶ returned
 *     │        │          │
 *     └────────┴──────────┴─▶ cancelled
 *
 * Every impactful transition (sending, cancelling, receiving) is a deliberate
 * step: the API layer confirms with the user before applying one. This module
 * only decides whether a transition is *legal* and computes the next state.
 */
import type { OrderStatus } from './types'

/** Legal successor states for each order status. Terminal states have none. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['confirmed', 'received', 'cancelled'],
  confirmed: ['received', 'cancelled'],
  received: ['returned'],
  cancelled: [],
  returned: [],
}

/** Statuses from which no further transition is possible. */
export const TERMINAL_STATUSES: OrderStatus[] = ['cancelled', 'returned']

/** Human labels (fr) for UI surfaces. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  confirmed: 'Confirmée',
  received: 'Reçue',
  cancelled: 'Annulée',
  returned: 'Retournée',
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to)
}

export interface TransitionResult {
  ok: boolean
  from: OrderStatus
  to: OrderStatus
  /** True when the destination is a terminal state (cancelled/returned). */
  terminal: boolean
  /** Populated when `ok` is false. */
  error?: string
  /** Side-effect hints for the caller (stock is only added on receipt). */
  effects: {
    /** Increment part stock by the ordered quantities. */
    incrementStock: boolean
    /** Decrement part stock (goods returned after having been received). */
    decrementStock: boolean
    /** Stamp the sent timestamp. */
    stampSent: boolean
    /** Stamp the received timestamp. */
    stampReceived: boolean
  }
}

const NO_EFFECTS = {
  incrementStock: false,
  decrementStock: false,
  stampSent: false,
  stampReceived: false,
}

/**
 * Validate and describe a status transition. Never mutates — returns the
 * decision plus the side effects the persistence layer should apply.
 */
export function transition(from: OrderStatus, to: OrderStatus): TransitionResult {
  if (from === to) {
    return { ok: false, from, to, terminal: isTerminal(to), error: `L'ordre est déjà « ${STATUS_LABELS[to]} ».`, effects: { ...NO_EFFECTS } }
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      from,
      to,
      terminal: isTerminal(to),
      error: `Transition « ${STATUS_LABELS[from]} » → « ${STATUS_LABELS[to]} » interdite.`,
      effects: { ...NO_EFFECTS },
    }
  }
  return {
    ok: true,
    from,
    to,
    terminal: isTerminal(to),
    effects: {
      incrementStock: to === 'received',
      decrementStock: to === 'returned',
      stampSent: to === 'sent',
      stampReceived: to === 'received',
    },
  }
}

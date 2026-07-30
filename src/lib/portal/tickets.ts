/**
 * SAV ticket state logic (Phase 2). Pure and unit-tested.
 *
 * Lifecycle: open → (client replies) pending → (staff replies) answered → closed.
 * A closed ticket can be reopened. `answered` and `pending` distinguish who is
 * waiting on whom so the garage can triage.
 */

export type TicketStatus = 'open' | 'pending' | 'answered' | 'closed'
export type TicketAction = 'client_reply' | 'staff_reply' | 'close' | 'reopen'

export const TICKET_CATEGORIES = ['general', 'invoice', 'repair', 'appointment', 'other'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

/** Compute the next status for a ticket action. */
export function nextTicketStatus(current: TicketStatus, action: TicketAction): TicketStatus {
  switch (action) {
    case 'staff_reply':
      return 'answered'
    case 'client_reply':
      return 'pending'
    case 'close':
      return 'closed'
    case 'reopen':
      return 'open'
    default:
      return current
  }
}

/** A closed ticket accepts no further messages until reopened. */
export function canReply(status: TicketStatus): boolean {
  return status !== 'closed'
}

export function isTicketCategory(v: unknown): v is TicketCategory {
  return typeof v === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(v)
}

export function isTicketPriority(v: unknown): v is TicketPriority {
  return typeof v === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(v)
}

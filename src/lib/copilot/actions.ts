/**
 * Action preparation — turns an action intent into a NOT-yet-executed proposal.
 * Every proposal is confirmation-gated; the copilot never performs a write itself.
 */
import type { IntentId, PreparedAction, Slots } from './types'

const ACTION_DEFS: Record<string, { summary: string; endpoint: string; params?: (s: Slots) => Record<string, unknown> }> = {
  create_appointment: { summary: 'Créer un rendez-vous', endpoint: '/api/jobs' },
  create_quote: { summary: 'Créer un devis', endpoint: '/api/quotes' },
  send_reminder: { summary: 'Envoyer un rappel au client', endpoint: '/api/notifications/dispatch', params: () => ({ trigger: 'appointment_reminder' }) },
  order_parts: { summary: 'Passer une commande fournisseur', endpoint: '/api/purchase-orders' },
  generate_report: { summary: 'Générer un rapport', endpoint: '/api/reports', params: () => ({ source: 'invoices', format: 'csv' }) },
}

export function prepareAction(intent: IntentId, slots: Slots): PreparedAction | null {
  const def = ACTION_DEFS[intent]
  if (!def) return null
  return {
    id: intent,
    summary: def.summary,
    endpoint: def.endpoint,
    method: 'POST',
    params: def.params ? def.params(slots) : {},
    confirmationRequired: true,
  }
}

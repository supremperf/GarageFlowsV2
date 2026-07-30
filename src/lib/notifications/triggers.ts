/**
 * Trigger → default channels mapping. Internal (in-app) is always included so a
 * record exists even when external channels are unconfigured.
 */
import type { Channel, NotificationTrigger } from './types'

export const TRIGGER_CHANNELS: Record<NotificationTrigger, Channel[]> = {
  appointment_reminder: ['sms', 'email', 'internal'],
  maintenance_due: ['email', 'internal'],
  vehicle_ready: ['sms', 'whatsapp', 'email', 'internal'],
  delay: ['sms', 'email', 'internal'],
  quote_accepted: ['internal'],
  quote_refused: ['internal'],
  invoice_overdue: ['email', 'internal'],
  warranty_expiring: ['email', 'internal'],
  order_received: ['internal'],
  stock_out: ['internal'],
}

export function channelsForTrigger(trigger: NotificationTrigger): Channel[] {
  return TRIGGER_CHANNELS[trigger] ?? ['internal']
}

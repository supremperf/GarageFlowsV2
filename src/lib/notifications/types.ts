/**
 * Multi-channel notification engine — shared types.
 */

export type Channel = 'email' | 'sms' | 'whatsapp' | 'push' | 'internal'

export const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp', 'push', 'internal']

/** Business events that can trigger a notification. */
export type NotificationTrigger =
  | 'appointment_reminder'
  | 'maintenance_due'
  | 'vehicle_ready'
  | 'delay'
  | 'quote_accepted'
  | 'quote_refused'
  | 'invoice_overdue'
  | 'warranty_expiring'
  | 'order_received'
  | 'stock_out'

/** A reusable message template. `subject` is used by email; `body` by all channels. */
export interface TemplateDef {
  key: string
  subject?: string
  body: string
  /** Declared variables (for documentation / editor autocompletion). */
  variables: string[]
}

export type NotificationContext = Record<string, unknown>

export interface RenderedMessage {
  subject?: string
  body: string
  /** Variables referenced by the template but absent from the context. */
  missingVars: string[]
}

export type DispatchStatus = 'sent' | 'failed' | 'skipped' | 'not_configured'

export interface DispatchResult {
  channel: Channel
  status: DispatchStatus
  message?: RenderedMessage
  attempts: number
  providerId?: string
  error?: string
}

/** A channel implementation (email transport, SMS gateway, in-app store, …). */
export interface ChannelProvider {
  readonly channel: Channel
  /** True when the provider has everything it needs to send (credentials, etc.). */
  isConfigured(): boolean
  send(to: string, message: RenderedMessage): Promise<{ ok: boolean; id?: string; error?: string }>
}

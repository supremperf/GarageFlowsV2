/**
 * GarageFlow AI Copilot (core) — shared types.
 *
 * A deterministic intent router that understands business questions, routes to
 * the right engine, and answers with real data — or PREPARES an impactful action
 * that ALWAYS requires explicit user confirmation before execution. This core is
 * pure and testable; an LLM can augment classification later without changing the
 * confirmation-gating contract.
 */

export type IntentKind = 'read' | 'action' | 'unknown'

export type IntentId =
  // read
  | 'pending_quotes'
  | 'today_revenue'
  | 'margin'
  | 'late_vehicles'
  | 'low_stock'
  | 'available_mechanics'
  | 'top_clients'
  | 'proactive'
  | 'forecast_revenue'
  | 'diagnostic'
  | 'vin_decode'
  // action (confirmation-gated)
  | 'create_appointment'
  | 'create_quote'
  | 'send_reminder'
  | 'order_parts'
  | 'generate_report'

export type Confidence = 'high' | 'medium' | 'low'

export interface Slots {
  vin?: string
  obdCode?: string
  days?: number
  /** Free-text remainder (e.g. the symptom for a diagnostic). */
  text?: string
}

export interface Classification {
  intent: IntentId | null
  kind: IntentKind
  confidence: Confidence
  slots: Slots
}

/** Prepared handoff, NOT an executed action. UI confirmation opens the existing form. */
export interface PreparedAction {
  id: IntentId
  summary: string
  /** Existing business endpoint for reference; chat never executes this request. */
  endpoint: string
  method: 'GET' | 'POST'
  params: Record<string, unknown>
  /** Always true — impactful actions are never auto-executed by the copilot. */
  confirmationRequired: true
}

export type CopilotResponseType = 'answer' | 'action_proposal' | 'clarify' | 'unknown'

export interface CopilotResponse {
  type: CopilotResponseType
  intent: IntentId | null
  message: string
  /** Present for read intents once the API resolves the data. */
  data?: unknown
  /** Present for action intents — requires confirmation. */
  action?: PreparedAction
  /** Which module/resolver the API should call for a read intent. */
  resolver?: string
  confidence: Confidence
  slots: Slots
}

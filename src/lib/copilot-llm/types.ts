/**
 * Copilot LLM layer — domain types. Framework-free & serialisable.
 *
 * A **safety-first** natural-language layer for the Copilot. A pluggable
 * `LlmProvider` may improve intent understanding and phrase answers, but the
 * numbers ALWAYS come from the deterministic engines: every LLM phrasing passes
 * a grounding guard that rejects any figure not present in the supplied facts,
 * falling back to the deterministic text. It works with no provider at all
 * (deterministic classification + verbatim facts).
 */

import type { SemanticUnderstanding, SemanticRequest } from '@/lib/copilot/semantic'
import type { ModelPlan, PlanningRequest } from '@/lib/copilot/planning'

export type LlmRole = 'system' | 'user' | 'assistant'
export interface LlmMessage {
  role: LlmRole
  content: string
}

export interface LlmCompletionOptions {
  temperature?: number
  maxTokens?: number
}

export interface LlmCompletion {
  text: string
  provider?: string
}

/** One intent the classifier can choose, with keywords for the offline fallback. */
export interface IntentSpec {
  id: string
  label: string
  keywords: string[]
}

export interface LlmClassification {
  intentId: string
  confidence: number
  slots?: Record<string, string>
}

export interface ClassifyResult extends LlmClassification {
  slots: Record<string, string>
  /** Where the classification came from. */
  source: 'llm' | 'fallback'
}

export interface PhraseInput {
  /**
   * The user's question — for tone and context ONLY.
   *
   * NOT an allowed number source, contrary to what this comment claimed until
   * the 15/08/2026. `phrase.ts:23` grounds against `facts` alone, and the header
   * of that file states why: a number typed by the user must never become an
   * allow-list entry that launders a fabrication. The doc said the opposite of
   * the code — an invitation to "fix" the code to match it, which would have
   * removed the guarantee.
   */
  query: string
  /** Deterministic facts the answer MUST stick to (numbers & text). */
  facts: string
  /** The safe deterministic phrasing to fall back to. */
  fallback: string
  intentId?: string
}

export interface PhraseResult {
  text: string
  grounded: boolean
  /** 'llm' when a grounded provider phrasing was used, otherwise a fallback reason. */
  source: 'llm' | 'fallback' | 'fallback_ungrounded'
}

/**
 * A pluggable LLM back-end. All methods are optional so the offline path needs
 * no provider; a real provider (Anthropic, OpenAI…) implements `complete` and,
 * on top of it, `classify` / `phrase` using the prompt builders.
 * `classify`/`phrase` may return null to defer to the deterministic path.
 */
export interface LlmProvider {
  readonly id: string
  readonly name: string
  interpret?(request: SemanticRequest, options?: { signal?: AbortSignal }): Promise<SemanticUnderstanding | null>
  plan?(request: PlanningRequest, options?: { signal?: AbortSignal }): Promise<ModelPlan | null>
  classify?(query: string, intents: IntentSpec[]): Promise<LlmClassification | null>
  phrase?(input: PhraseInput): Promise<string | null>
  complete?(messages: LlmMessage[], opts?: LlmCompletionOptions): Promise<LlmCompletion>
}

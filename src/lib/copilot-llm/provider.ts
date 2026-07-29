/**
 * Provider resolution. Returns the configured `LlmProvider`, or null when none
 * is set up — in which case the Copilot stays fully deterministic.
 *
 * A real provider implements `complete(messages)` against an LLM API and derives
 * `classify` / `phrase` from the prompt builders in ./prompts. It is intentionally
 * NOT bundled (it needs an API key and a network policy); wire it here, e.g.:
 *
 *   class AnthropicProvider implements LlmProvider {
 *     id = 'anthropic'; name = 'Claude'
 *     async complete(messages) { … call the API … }
 *     async classify(q, intents) {
 *       const { text } = await this.complete(buildClassifyMessages(q, intents))
 *       return JSON.parse(text)   // {intentId, confidence}
 *     }
 *     async phrase(input) {
 *       const { text } = await this.complete(buildPhraseMessages(input))
 *       return text               // grounding guard validates it downstream
 *     }
 *   }
 *   if (process.env.GARAGEFLOW_LLM === 'anthropic') return new AnthropicProvider()
 */
import type { LlmProvider } from './types'

let cached: LlmProvider | null | undefined

export function resolveLlmProvider(): LlmProvider | null {
  if (cached !== undefined) return cached
  // No provider configured by default → deterministic Copilot.
  cached = null
  return cached
}

/** Test hook to inject/clear a provider. */
export function __setLlmProvider(p: LlmProvider | null | undefined): void {
  cached = p
}

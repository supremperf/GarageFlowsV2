/**
 * Answer phrasing with a grounding guarantee. Prefers a provider's natural
 * phrasing but only when it is grounded in the facts (+ the query); otherwise
 * returns the deterministic fallback verbatim. A provider error/empty result
 * also yields the fallback. With no provider, the fallback is returned as-is.
 */
import { isGrounded } from './ground'
import type { LlmProvider, PhraseInput, PhraseResult } from './types'

export async function phraseAnswer(input: PhraseInput, provider?: LlmProvider | null): Promise<PhraseResult> {
  if (provider?.phrase) {
    try {
      const candidate = await provider.phrase(input)
      if (candidate && candidate.trim()) {
        // The query is an allowed number source (it may echo figures the user typed).
        if (isGrounded(candidate, `${input.facts} ${input.query}`)) {
          return { text: candidate.trim(), grounded: true, source: 'llm' }
        }
        // Ungrounded → reject the model's phrasing, keep the deterministic answer.
        return { text: input.fallback, grounded: false, source: 'fallback_ungrounded' }
      }
    } catch {
      // fall through to the deterministic fallback
    }
  }
  return { text: input.fallback, grounded: true, source: 'fallback' }
}

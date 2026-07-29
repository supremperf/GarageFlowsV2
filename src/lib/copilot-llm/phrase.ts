/**
 * Answer phrasing with a grounding guarantee. Prefers a provider's natural
 * phrasing but only when it is grounded in the FACTS (not the query — a user's
 * typed number must not become an allow-list entry that launders a fabrication);
 * otherwise returns the deterministic fallback verbatim. A provider error, empty
 * result, or timeout also yields the fallback. With no provider, the fallback is
 * returned as-is.
 */
import { isGrounded } from './ground'
import { DEFAULT_LLM_TIMEOUT_MS, withTimeout } from './timeout'
import type { LlmProvider, PhraseInput, PhraseResult } from './types'

export interface PhraseOptions {
  timeoutMs?: number
}

export async function phraseAnswer(input: PhraseInput, provider?: LlmProvider | null, opts: PhraseOptions = {}): Promise<PhraseResult> {
  if (provider?.phrase) {
    try {
      const candidate = await withTimeout(Promise.resolve(provider.phrase(input)), opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS)
      if (candidate && candidate.trim()) {
        // Ground strictly against the deterministic facts only.
        if (isGrounded(candidate, input.facts)) {
          return { text: candidate.trim(), grounded: true, source: 'llm' }
        }
        // Ungrounded → reject the model's phrasing, keep the deterministic answer.
        return { text: input.fallback, grounded: false, source: 'fallback_ungrounded' }
      }
    } catch {
      // provider error / timeout → deterministic fallback
    }
  }
  return { text: input.fallback, grounded: true, source: 'fallback' }
}

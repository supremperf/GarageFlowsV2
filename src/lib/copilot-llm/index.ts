/**
 * Copilot LLM layer — public entry point.
 *
 *   import { classifyIntent, phraseAnswer, resolveLlmProvider } from '@/lib/copilot-llm'
 *
 *   const provider = resolveLlmProvider()                 // null unless configured
 *   const intent = await classifyIntent(query, INTENTS, provider)
 *   const { text } = await phraseAnswer({ query, facts, fallback }, provider)
 *
 * Safety-first: the provider may rephrase, but every figure it emits is checked
 * against the facts (grounding guard) and rejected if invented. Works fully
 * offline with no provider (deterministic classification + verbatim facts).
 */
export * from './types'
export { parseLoose, extractNumbers, numbersMatch, isGrounded, enforceGrounding } from './ground'
export { ruleClassify, classifyIntent } from './classify'
export { buildClassifyMessages, buildPhraseMessages } from './prompts'
export { phraseAnswer } from './phrase'
export { resolveLlmProvider } from './provider'

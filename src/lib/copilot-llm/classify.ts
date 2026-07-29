/**
 * Intent classification. A deterministic keyword classifier (the offline
 * fallback) plus an orchestrator that prefers a provider's classification but
 * ONLY when it names a known intent — a hallucinated intent id is rejected.
 */
import type { ClassifyResult, IntentSpec, LlmProvider } from './types'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Deterministic keyword scorer over the intent specs. */
export function ruleClassify(query: string, intents: IntentSpec[]): { intentId: string; confidence: number; slots: Record<string, string> } {
  const hay = ` ${normalize(query)} `
  let best = ''
  let bestHits = 0
  for (const intent of intents) {
    let hits = 0
    for (const kw of intent.keywords) {
      const k = normalize(kw)
      if (k && hay.includes(` ${k} `)) hits += 1
    }
    if (hits > bestHits) { bestHits = hits; best = intent.id }
  }
  if (bestHits === 0) return { intentId: 'unknown', confidence: 0, slots: {} }
  return { intentId: best, confidence: Math.min(1, 0.4 + bestHits * 0.15), slots: {} }
}

/**
 * Classify an intent, preferring the provider but falling back deterministically
 * when there is no provider, it errors, or it returns an unknown intent id.
 */
export async function classifyIntent(query: string, intents: IntentSpec[], provider?: LlmProvider | null): Promise<ClassifyResult> {
  if (provider?.classify) {
    try {
      const r = await provider.classify(query, intents)
      if (r && intents.some((i) => i.id === r.intentId)) {
        return { intentId: r.intentId, confidence: r.confidence, slots: r.slots ?? {}, source: 'llm' }
      }
    } catch {
      // fall through to the deterministic classifier
    }
  }
  return { ...ruleClassify(query, intents), source: 'fallback' }
}

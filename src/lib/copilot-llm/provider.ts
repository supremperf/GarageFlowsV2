/** Server-only, explicitly opted-in classification. Never sends DB results or history. */
import { z } from 'zod'
import { buildClassifyMessages } from './prompts'
import type { IntentSpec, LlmProvider } from './types'

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEADLINE_MS = 2500
const ClassificationSchema = z.object({
  intentId: z.string().max(80), confidence: z.number().finite().min(0).max(1),
}).strict()
export type ProviderState = 'initializing' | 'ready' | 'degraded' | 'unavailable'
export interface ProviderHealth { state: ProviderState; reason: string; model?: string; checkedAt?: string }

/** Fixed official endpoint; no caller-controlled URLs, tools, retries or free-form phrasing. */
export class AnthropicClassifier implements LlmProvider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic (classification uniquement)'
  private health: ProviderHealth
  private retryAfter = 0
  constructor(private readonly key: string, private readonly model: string) {
    this.health = { state: 'initializing', reason: 'Connexion et modèle non encore vérifiés.', model }
  }
  status(): ProviderHealth {
    if (this.health.state === 'ready' && this.health.checkedAt && Date.now() - Date.parse(this.health.checkedAt) > 300_000) {
      return { ...this.health, state: 'initializing', reason: 'Dernière classification trop ancienne ; disponibilité à vérifier lors de la prochaine demande au modèle.' }
    }
    return { ...this.health }
  }
  async classify(query: string, intents: IntentSpec[]) {
    if (Date.now() < this.retryAfter) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
    try {
      const messages = buildClassifyMessages(query.slice(0, 500), intents)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.model, max_tokens: 128, temperature: 0,
          system: messages[0].content, messages: [{ role: 'user', content: messages[1].content }] }),
      })
      if (!response.ok) { await response.body?.cancel(); throw new Error('provider_http') }
      // Bound the response while streaming, including dishonest/missing Content-Length.
      const reader = response.body?.getReader()
      if (!reader) throw new Error('provider_body')
      let bytes = 0
      const decoder = new TextDecoder()
      let text = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > 16384) { await reader.cancel(); throw new Error('provider_size') }
          text += decoder.decode(value, { stream: true })
        }
        text += decoder.decode()
      } finally { reader.releaseLock() }
      const envelope: unknown = JSON.parse(text)
      const content = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(8) }).parse(envelope).content
      const result = ClassificationSchema.parse(JSON.parse(content.filter(c => c.type === 'text').map(c => c.text ?? '').join('')))
      if (result.intentId !== 'unknown' && !intents.some(i => i.id === result.intentId)) throw new Error('provider_intent')
      this.health = { state: 'ready', reason: 'Dernière classification validée ; aucune garantie pour la requête suivante.', model: this.model, checkedAt: new Date().toISOString() }
      return result
    } catch {
      // No upstream text, key, query or customer data in logs/status/errors.
      this.retryAfter = Date.now() + 30_000
      this.health = { state: 'degraded', reason: 'Classification externe indisponible ou réponse invalide ; repli local actif.', model: this.model, checkedAt: new Date().toISOString() }
      return null
    } finally { clearTimeout(timer) }
  }
}
let cached: LlmProvider | null | undefined
let configFingerprint = ''
let testOverride = false
export function resolveLlmProvider(): LlmProvider | null {
  if (testOverride) return cached ?? null
  const setting = process.env.GARAGEFLOW_LLM ?? 'off'
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  const model = process.env.GARAGEFLOW_LLM_MODEL || DEFAULT_MODEL
  // In-memory only; never logged or exposed. Detect config changes, including key rotation.
  const fingerprint = JSON.stringify([setting, key, model])
  if (cached !== undefined && fingerprint === configFingerprint) return cached
  configFingerprint = fingerprint
  cached = setting === 'anthropic' && key.trim() && /^[a-zA-Z0-9._-]{1,100}$/.test(model)
    ? new AnthropicClassifier(key, model) : null
  return cached
}
export function providerHealth(): ProviderHealth {
  const provider = resolveLlmProvider()
  if (provider instanceof AnthropicClassifier) return provider.status()
  return { state: 'unavailable', reason: process.env.GARAGEFLOW_LLM === 'anthropic'
    ? 'Clé ou identifiant de modèle manquant/invalide ; mode local actif.' : 'Modèle externe désactivé ; mode local actif.' }
}
/** Test-only injection. Undefined clears the override and config cache. */
export function __setLlmProvider(p: LlmProvider | null | undefined): void {
  cached = p
  testOverride = p !== undefined
  configFingerprint = ''
}

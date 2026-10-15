/** Server-only, explicitly opted-in classification. Never sends DB results or history. */
import { z } from 'zod'
import { SemanticSchema, type SemanticRequest } from '@/lib/copilot/semantic'
import { buildSemanticMessages } from './prompts'
import { PlanSchema, type PlanningRequest } from '@/lib/copilot/planning'
import { buildPlanningMessages } from './prompts'
import { buildClassifyMessages } from './prompts'
import type { IntentSpec, LlmProvider } from './types'

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEADLINE_MS = 2500
const ClassificationSchema = z.object({
  intentId: z.string().max(80), confidence: z.number().finite().min(0).max(1),
}).strict()
export type ProviderState = 'initializing' | 'ready' | 'degraded' | 'unavailable'
export interface ProviderAttempt { outcome: 'budget_blocked' | 'valid_json_contract' | 'circuit_open' | 'aborted' | 'timeout' | 'http_error' | 'invalid_response' | 'transport_error'; durationMs: number; httpStatus: number | null; usage: { input_tokens: number; output_tokens: number } | null }
export interface ProviderHealth { state: ProviderState; reason: string; model?: string; checkedAt?: string }

/** Fixed official endpoint; no caller-controlled URLs, tools, retries or free-form phrasing. */
export class AnthropicClassifier implements LlmProvider {
  readonly id = 'anthropic'
  readonly name = 'Anthropic (planification contrôlée)'
  private health: ProviderHealth
  private retryAfter = 0
  private attempt: ProviderAttempt | null = null
  lastAttempt(): ProviderAttempt | null { return this.attempt ? { ...this.attempt, usage: this.attempt.usage ? { ...this.attempt.usage } : null } : null }
  private readonly simulatedTransport?: typeof fetch
  constructor(private readonly key: string, private readonly model: string,
    // Explicit protocol simulation is additionally forbidden outside test runtime.
    // The application factory NEVER supplies one; there is no global fetch fallback.
    simulatedTransport?: typeof fetch) {
    this.simulatedTransport = process.env.NODE_ENV === 'test' ? simulatedTransport : undefined
    this.health = this.simulatedTransport
      ? { state: 'initializing', reason: 'Transport de simulation ; aucune validation fournisseur réel.', model }
      : { state: 'unavailable', reason: 'Mode payant bloqué : plafond monétaire effectif non vérifié.', model }
  }

  status(): ProviderHealth {
    if (this.health.state === 'ready' && this.health.checkedAt && Date.now() - Date.parse(this.health.checkedAt) > 300_000) {
      return { ...this.health, state: 'initializing', reason: 'Dernière classification trop ancienne ; disponibilité à vérifier lors de la prochaine demande au modèle.' }
    }
    return { ...this.health }
  }
  async classify(query: string, intents: IntentSpec[]) {
    const messages = buildClassifyMessages(query.slice(0, 500), intents)
    return this.request(messages[0].content, messages[1].content, 128, value => {
      const result = ClassificationSchema.parse(value)
      if (result.intentId !== 'unknown' && !intents.some(i => i.id === result.intentId)) throw new Error('provider_intent')
      return result
    })
  }
  async interpret(request: SemanticRequest, options: { signal?: AbortSignal } = {}) {
    const messages = buildSemanticMessages(request)
    // Same 512-token/one-request ceiling, no extra paid fallback call.
    return this.request(messages[0].content, messages[1].content, 512, value => SemanticSchema.parse(value), options.signal)
  }
  async plan(request: PlanningRequest, options: { signal?: AbortSignal } = {}) {
    const messages = buildPlanningMessages(request)
    return this.request(messages[0].content, messages[1].content, 512, value => PlanSchema.parse(value), options.signal)
  }
  private async request<T>(system: string, user: string, tokens: number, parse: (value: unknown) => T, parent?: AbortSignal): Promise<T | null> {
    // Common choke point for classify, plan and interpret, including direct callers.
    // There is currently NO independently verified monetary enforcement service.
    // Keep all production IO closed, even with valid server key/model/opt-in.
    if (!this.simulatedTransport) {
      this.attempt = { outcome: 'budget_blocked', durationMs: 0, httpStatus: null, usage: null }
      return null
    }
    if (parent?.aborted || Date.now() < this.retryAfter) {
      this.attempt = { outcome: parent?.aborted ? 'aborted' : 'circuit_open', durationMs: 0, httpStatus: null, usage: null }; return null
    }
    const started = performance.now()
    let stage: 'transport' | 'response' = 'transport'
    let httpStatus: number | null = null
    let usage: ProviderAttempt['usage'] = null
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    parent?.addEventListener('abort', onAbort, { once: true })
    if (parent?.aborted) controller.abort()
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
    try {
      const response = await this.simulatedTransport('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.model, max_tokens: tokens, temperature: 0,
          system, messages: [{ role: 'user', content: user }] }),
      })
      httpStatus = response.status
      stage = 'response'
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
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const envelope: unknown = JSON.parse(text)
      const usageResult = z.object({ usage: z.object({ input_tokens: z.number().int().min(0).max(10_000_000), output_tokens: z.number().int().min(0).max(10_000_000) }) }).safeParse(envelope)
      if (usageResult.success) usage = usageResult.data.usage
      const content = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(8) }).parse(envelope).content
      const result = parse(JSON.parse(content.filter(c => c.type === 'text').map(c => c.text ?? '').join('')))
      this.attempt = { outcome: 'valid_json_contract', durationMs: performance.now() - started, httpStatus, usage }
      this.health = { state: 'ready', reason: 'Dernière réponse structurée validée ; outils/droits vérifiés séparément, aucune garantie pour la requête suivante.', model: this.model, checkedAt: new Date().toISOString() }
      return result
    } catch {
      const outcome: ProviderAttempt['outcome'] = parent?.aborted ? 'aborted' : controller.signal.aborted ? 'timeout' : httpStatus !== null && (httpStatus < 200 || httpStatus >= 300) ? 'http_error' : stage === 'response' ? 'invalid_response' : 'transport_error'
      this.attempt = { outcome, durationMs: performance.now() - started, httpStatus, usage }
      // User cancellation is not a provider outage and must not open the circuit.
      if (parent?.aborted) return null
      // No upstream text, key, query or customer data in logs/status/errors.
      this.retryAfter = Date.now() + 30_000
      this.health = { state: 'degraded', reason: 'Classification externe indisponible ou réponse invalide ; repli local actif.', model: this.model, checkedAt: new Date().toISOString() }
      return null
    } finally { clearTimeout(timer); parent?.removeEventListener('abort', onAbort) }
  }
}
let cached: LlmProvider | null | undefined
let configFingerprint = ''
let testOverride = false
export function resolveLlmProvider(): LlmProvider | null {
  if (testOverride && process.env.NODE_ENV === 'test') return cached ?? null
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
  if (process.env.NODE_ENV !== 'test' && p !== undefined) throw new Error('Test provider injection forbidden outside test runtime')
  cached = p
  testOverride = p !== undefined
  configFingerprint = ''
}

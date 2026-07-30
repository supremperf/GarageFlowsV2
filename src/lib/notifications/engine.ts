/**
 * NotificationEngine — resolve a template, render it against a context, and
 * dispatch it through the matching channel provider with bounded retries. It
 * never throws on a provider failure: every attempt yields a structured
 * DispatchResult so callers can persist a complete history/journal.
 */
import { InternalProvider } from './channels'
import { renderTemplate } from './template'
import { getTemplate } from './templates'
import { channelsForTrigger } from './triggers'
import type {
  Channel,
  ChannelProvider,
  DispatchResult,
  NotificationContext,
  NotificationTrigger,
  RenderedMessage,
  TemplateDef,
} from './types'

export interface NotificationEngineOptions {
  providers?: ChannelProvider[]
  /** Template resolver (defaults to the built-in template set). */
  templates?: (key: string) => TemplateDef | null
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
  backoff?: (attempt: number) => number
}

export interface DispatchInput {
  channel: Channel
  to: string
  context: NotificationContext
  templateKey?: string
  template?: TemplateDef
  trigger?: NotificationTrigger
}

export interface TriggerDispatchInput {
  trigger: NotificationTrigger
  to: string
  context: NotificationContext
  channels?: Channel[]
}

export function renderMessage(template: TemplateDef, ctx: NotificationContext): RenderedMessage {
  const body = renderTemplate(template.body, ctx)
  const missing = new Set(body.missingVars)
  let subject: string | undefined
  if (template.subject) {
    const s = renderTemplate(template.subject, ctx)
    subject = s.text
    s.missingVars.forEach((v) => missing.add(v))
  }
  return { subject, body: body.text, missingVars: Array.from(missing) }
}

export class NotificationEngine {
  private readonly byChannel = new Map<Channel, ChannelProvider>()
  private readonly resolveTemplate: (key: string) => TemplateDef | null
  private readonly maxAttempts: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly backoff: (attempt: number) => number

  constructor(opts: NotificationEngineOptions = {}) {
    const providers = opts.providers ?? [new InternalProvider()]
    for (const p of providers) this.byChannel.set(p.channel, p)
    // Internal channel is always available even if not explicitly provided.
    if (!this.byChannel.has('internal')) this.byChannel.set('internal', new InternalProvider())
    this.resolveTemplate = opts.templates ?? getTemplate
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3)
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.backoff = opts.backoff ?? ((attempt) => Math.min(8000, 250 * 2 ** (attempt - 1)))
  }

  /** Dispatch a single message to one channel. */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const template =
      input.template ??
      this.resolveTemplate(input.templateKey ?? input.trigger ?? '')
    if (!template) {
      return { channel: input.channel, status: 'skipped', attempts: 0, error: 'no_template' }
    }

    const message = renderMessage(template, input.context)
    const provider = this.byChannel.get(input.channel)
    if (!provider || !provider.isConfigured()) {
      return { channel: input.channel, status: 'not_configured', message, attempts: 0 }
    }

    let attempts = 0
    let lastError: string | undefined
    while (attempts < this.maxAttempts) {
      attempts++
      let res: { ok: boolean; id?: string; error?: string }
      try {
        res = await provider.send(input.to, message)
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      if (res.ok) {
        return { channel: input.channel, status: 'sent', message, attempts, providerId: res.id }
      }
      lastError = res.error
      if (attempts < this.maxAttempts) await this.sleep(this.backoff(attempts))
    }
    return { channel: input.channel, status: 'failed', message, attempts, error: lastError }
  }

  /** Dispatch a trigger to its default (or provided) channels. */
  async dispatchTrigger(input: TriggerDispatchInput): Promise<DispatchResult[]> {
    const channels = input.channels ?? channelsForTrigger(input.trigger)
    const results: DispatchResult[] = []
    for (const channel of channels) {
      results.push(
        await this.dispatch({
          channel,
          to: input.to,
          context: input.context,
          trigger: input.trigger,
        }),
      )
    }
    return results
  }
}

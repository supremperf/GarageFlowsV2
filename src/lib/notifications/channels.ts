/**
 * Channel providers. Each wraps a concrete transport; all share the
 * ChannelProvider interface so the engine treats them uniformly.
 *
 * The engine is transport-agnostic: EmailProvider/SmsProvider/... are
 * constructed with a `send` function (and a `configured` flag), so the API layer
 * can wire the real transports (nodemailer for email, a gateway for SMS, …)
 * while tests inject mocks. Nothing here holds credentials directly.
 */
import type { Channel, ChannelProvider, RenderedMessage } from './types'

type SendFn = (to: string, message: RenderedMessage) => Promise<{ ok: boolean; id?: string; error?: string }>

/** Generic provider backed by an injected send function. */
export class FunctionProvider implements ChannelProvider {
  constructor(
    readonly channel: Channel,
    private readonly sender: SendFn | null,
  ) {}
  isConfigured(): boolean {
    return this.sender !== null
  }
  async send(to: string, message: RenderedMessage) {
    if (!this.sender) return { ok: false, error: 'not_configured' }
    return this.sender(to, message)
  }
}

/**
 * Placeholder for a future recipient-visible in-app inbox.
 *
 * The notification journal is not delivery to a recipient, so this channel must
 * stay unconfigured until a real inbox/persistence path exists. In particular,
 * it must never turn a journal write into a reported successful delivery.
 */
export class InternalProvider implements ChannelProvider {
  readonly channel: Channel = 'internal'
  isConfigured(): boolean {
    return false
  }
  async send() {
    return { ok: false, error: 'not_configured' }
  }
}

/** Records every send — for tests and dry-runs. */
export class MockProvider implements ChannelProvider {
  readonly sent: Array<{ to: string; message: RenderedMessage }> = []
  constructor(
    readonly channel: Channel,
    private readonly behavior: { ok?: boolean; failTimes?: number } = {},
  ) {}
  private failsLeft = this.behavior.failTimes ?? 0
  isConfigured(): boolean {
    return true
  }
  async send(to: string, message: RenderedMessage) {
    this.sent.push({ to, message })
    if (this.failsLeft > 0) {
      this.failsLeft--
      return { ok: false, error: 'transient' }
    }
    return { ok: this.behavior.ok !== false, id: `mock-${this.sent.length}` }
  }
}

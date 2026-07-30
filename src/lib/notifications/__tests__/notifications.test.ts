import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  extractVariables,
  renderMessage,
  NotificationEngine,
  MockProvider,
  getTemplate,
  type TemplateDef,
} from '../index'

const noSleep = async () => {}

describe('renderTemplate', () => {
  it('interpolates simple and nested variables', () => {
    const r = renderTemplate('Bonjour {{ client.name }}, {{ vehicle }}', {
      client: { name: 'Léa' },
      vehicle: 'Clio',
    })
    expect(r.text).toBe('Bonjour Léa, Clio')
    expect(r.missingVars).toHaveLength(0)
  })

  it('applies filters (upper, currency, date)', () => {
    expect(renderTemplate('{{ n | upper }}', { n: 'abc' }).text).toBe('ABC')
    expect(renderTemplate('{{ a | currency }}', { a: 1234.5 }).text).toBe('1234,50 €')
    expect(renderTemplate('{{ d | date }}', { d: '2026-07-29' }).text).toBe('29/07/2026')
  })

  it('tracks missing variables but honors a default filter', () => {
    const r = renderTemplate('{{ missing }} {{ opt | default:"—" }}', {})
    expect(r.text).toBe(' —')
    expect(r.missingVars).toEqual(['missing'])
  })
})

describe('extractVariables', () => {
  it('lists referenced variable paths', () => {
    expect(extractVariables('{{ a }} {{ b.c | upper }}')).toEqual(['a', 'b.c'])
  })
})

describe('renderMessage', () => {
  it('renders subject + body and merges missing vars', () => {
    const tpl: TemplateDef = { key: 't', subject: 'Hi {{ a }}', body: '{{ a }} {{ b }}', variables: ['a', 'b'] }
    const m = renderMessage(tpl, { a: 'X' })
    expect(m.subject).toBe('Hi X')
    expect(m.body).toBe('X ')
    expect(m.missingVars).toEqual(['b'])
  })
})

describe('NotificationEngine.dispatch', () => {
  const template: TemplateDef = { key: 't', subject: 'S', body: 'Hello {{ name }}', variables: ['name'] }

  it('sends via the internal channel by default', async () => {
    const engine = new NotificationEngine({ sleep: noSleep })
    const r = await engine.dispatch({ channel: 'internal', to: 'u1', context: { name: 'A' }, template })
    expect(r.status).toBe('sent')
    expect(r.attempts).toBe(1)
  })

  it('reports not_configured for a channel with no provider', async () => {
    const engine = new NotificationEngine({ sleep: noSleep })
    const r = await engine.dispatch({ channel: 'sms', to: '+33', context: { name: 'A' }, template })
    expect(r.status).toBe('not_configured')
    expect(r.message?.body).toBe('Hello A')
  })

  it('retries a transient failure then succeeds', async () => {
    const sms = new MockProvider('sms', { failTimes: 2 })
    const engine = new NotificationEngine({ providers: [sms], maxAttempts: 3, sleep: noSleep })
    const r = await engine.dispatch({ channel: 'sms', to: '+33', context: { name: 'A' }, template })
    expect(r.status).toBe('sent')
    expect(r.attempts).toBe(3)
    expect(sms.sent).toHaveLength(3)
  })

  it('fails after exhausting attempts', async () => {
    const sms = new MockProvider('sms', { failTimes: 9 })
    const engine = new NotificationEngine({ providers: [sms], maxAttempts: 2, sleep: noSleep })
    const r = await engine.dispatch({ channel: 'sms', to: '+33', context: { name: 'A' }, template })
    expect(r.status).toBe('failed')
    expect(r.attempts).toBe(2)
    expect(r.error).toBe('transient')
  })

  it('skips when no template resolves', async () => {
    const engine = new NotificationEngine({ sleep: noSleep })
    const r = await engine.dispatch({ channel: 'internal', to: 'u1', context: {}, templateKey: 'does_not_exist' })
    expect(r.status).toBe('skipped')
    expect(r.error).toBe('no_template')
  })
})

describe('NotificationEngine.dispatchTrigger', () => {
  it('dispatches to each default channel, using built-in templates', async () => {
    const sms = new MockProvider('sms')
    const engine = new NotificationEngine({ providers: [sms], sleep: noSleep })
    const results = await engine.dispatchTrigger({
      trigger: 'vehicle_ready',
      to: '+33600000000',
      context: { clientName: 'Léa', vehicleModel: 'Clio', licensePlate: 'AB-123-CD', amount: 240, garageName: 'Garage X' },
    })
    const byChannel = Object.fromEntries(results.map((r) => [r.channel, r.status]))
    // vehicle_ready → ['sms','whatsapp','email','internal']
    expect(byChannel.sms).toBe('sent')
    expect(byChannel.whatsapp).toBe('not_configured')
    expect(byChannel.email).toBe('not_configured')
    expect(byChannel.internal).toBe('sent')
    // The built-in template rendered with the currency filter.
    expect(sms.sent[0].message.body).toContain('240,00 €')
  })

  it('exposes a built-in template for every trigger', () => {
    expect(getTemplate('invoice_overdue')?.subject).toContain('impayée')
  })
})

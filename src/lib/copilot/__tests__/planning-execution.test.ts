import { afterEach, describe, expect, it, vi } from 'vitest'
import { understand, ConversationSchema } from '../conversation'
import { bindReadPlan, PlanSchema, planningContext, previousReference } from '../planning'
import { executeReadPlan, validateExecutionPlan, type ReadResult } from '../execution'
import { inspectAvailability } from '../readiness'
import { TOOLS, validateCall, type ToolCall } from '../tools'
import type { LlmProvider } from '@/lib/copilot-llm/types'

const input = (query: string, history: string[] = []) => ConversationSchema.parse({ query, history: history.map(content => ({ role: 'user', content })) })
const model = (value: unknown): LlmProvider => ({ id: 'scripted-planner', name: 'Scripted planner, not live model', plan: async () => value as never })
const read = (toolId: string, source = 'current') => ({ mode: 'read', confidence: 0.95, calls: [{ toolId, source }] })
const verified: ReadResult = { type: 'answer', intent: 'low_stock', confidence: 'medium', slots: {}, message: 'Fixture fact', data: { fixture: true }, ancrage: { verifie: true }, execution: { readOnly: true, status: 'completed', observedAt: '2026-10-15T00:00:00Z' } }
afterEach(() => vi.useRealTimers())
describe('phase 2 planning without external services', () => {
  it('catalogues every read and existing handoff with schemas, policy and verification', () => {
    expect(TOOLS).toHaveLength(17); expect(new Set(TOOLS.map(t => t.id)).size).toBe(17)
    for (const t of TOOLS) { expect(t.schema).toBeDefined(); expect(t.access).toBeTruthy(); expect(t.errors.length).toBeGreaterThan(0); expect(t.verification).toBeTruthy(); expect(t.confirmation).toBeTruthy() }
  })
  it.each(['t as quoi comme stoc bas', 'les pieces ki manquent'])('recognizes bounded familiar variants locally: %s', async query => {
    expect((await understand(input(query), 'RECEPTIONIST', null)).resolver).toBe('low_stock')
  })
  it('selects a read from a natural non-keyword request using a validated plan', async () => {
    const r = await understand(input('Est-ce que les rayonnages permettent de travailler sans rupture ?'), 'RECEPTIONIST', model(read('low_stock')))
    expect(r.plan?.calls).toEqual([{ toolId: 'low_stock', input: {} }]); expect(r.planning?.source).toBe('model')
  })
  it('plans multiple locally recognizable independent reads without losing subrequests', async () => {
    const r = await understand(input('CA du jour et stock bas et marge du mois'), 'OWNER', null)
    expect(r.plan?.calls.map(c => c.toolId)).toEqual(['today_revenue', 'low_stock', 'margin'])
  })
  it('asks rather than silently executing one partial request in an unsupported compound', async () => {
    expect((await understand(input('stock bas et réserve un train pour Paris'), 'OWNER', null)).type).toBe('clarify')
  })
  it.each(['CA du mois dernier', 'marge de la semaine', 'prévision du CA de l’année'])('does not invent arbitrary periods: %s', async query => {
    expect((await understand(input(query), 'OWNER', null)).type).toBe('clarify')
  })
  it('uses model-selected known articles without generated business facts', async () => {
    const r = await understand(input('Montre-moi le fonctionnement des documents commerciaux'), 'OWNER', model({ mode: 'help', confidence: 0.9, articleIds: ['quotes'] }))
    expect(r.sources?.map(s => s.id)).toEqual(['quotes']); expect(r.data).toBeUndefined(); expect(r.action).toBeUndefined()
  })
  it.each([
    { mode: 'read', confidence: 1, calls: [{ toolId: 'execute_sql', source: 'current' }] },
    { mode: 'read', confidence: 1, calls: [{ toolId: 'low_stock', source: 'current', sql: 'DROP DATABASE' }] },
    { mode: 'read', confidence: 1, calls: [{ toolId: 'low_stock', source: 'current' }], result: 'invented paid invoice' },
    { mode: 'read', confidence: NaN, calls: [{ toolId: 'low_stock', source: 'current' }] },
    { mode: 'help', confidence: 1, articleIds: ['unknown'] },
  ])('rejects adversarial or invalid model output without dispatch: %j', async value => {
    const r = await understand(input('Une demande inhabituelle'), 'RECEPTIONIST', model(value))
    expect(r.plan).toBeUndefined(); expect(r.data).toBeUndefined(); expect(r.action).toBeUndefined(); expect(r.planning?.fallback).toBeTruthy()
  })
  it('does not select a forbidden article or financial tool for receptionist', async () => {
    for (const value of [read('margin'), { mode: 'help', confidence: 1, articleIds: ['finance'] }]) {
      const r = await understand(input('Une demande inhabituelle'), 'RECEPTIONIST', model(value))
      expect(r.plan).toBeUndefined(); expect(r.sources).toBeUndefined()
    }
  })
  it('rebinds the most recent explicit reference from six user questions, not model params', async () => {
    const r = await understand(input('Et son statut ?', ['Retrouve le dossier AB-123-CD', 'Et la marge ?', 'Explique les devis']), 'OWNER', model(read('job_search', 'previous_user')))
    expect(r.plan?.calls[0].input).toEqual({ reference: 'AB-123-CD' })
    expect(r.data).toBeUndefined()
  })
  it('understands contextual pronouns inside a natural sentence, not only at the beginning', async () => {
    const r = await understand(input('Qu’en est-il de cet ancien dossier ?', ['Retrouve le dossier AB-123-CD']), 'OWNER', model(read('job_search', 'previous_user')))
    expect(r.plan?.calls[0].input).toEqual({ reference: 'AB-123-CD' })
  })
  it('does not discard a previously requested unsupported period in a follow-up', async () => {
    const r = await understand(input('Et celui-ci ?', ['marge de la semaine']), 'OWNER', model(read('margin', 'previous_user')))
    expect(r.type).toBe('clarify'); expect(r.plan).toBeUndefined()
  })
  it('keeps context metadata free of historical PII, results and secrets', () => {
    const ctx = planningContext(input('Et son statut ?', ['Retrouve le dossier de FixturePrivateName', 'api_key=test-only-placeholder', 'marge 9999']))
    expect(ctx.hasReference).toBe(true)
    expect(JSON.stringify(ctx)).not.toMatch(/FixturePrivateName|9999|test-only-placeholder/)
  })
  it('never claims a reference survives outside the six-question window', () => {
    const q = input('Et son statut ?', ['x','x','x','x','x','x'])
    expect(previousReference(q).value).toBeNull()
    expect(() => bindReadPlan(PlanSchema.parse(read('job_search', 'previous_user')) as never, q, 'OWNER')).toThrow('needs_input')
  })
  it('asks to disambiguate contradictory references', async () => {
    const r = await understand(input('Retrouve les dossiers AB-123-CD et EF-456-GH'), 'OWNER', model(read('job_search')))
    expect(r.type).toBe('clarify'); expect(r.plan).toBeUndefined()
  })
  it('requires local input for VIN and symptoms, never model-provided values', async () => {
    for (const tool of ['vin_decode', 'diagnostic']) {
      const r = await understand(input('Une demande inhabituelle'), 'OWNER', model(read(tool)))
      expect(r.type).toBe('clarify'); expect(r.plan).toBeUndefined()
    }
  })
  it('recognizes out of scope without pretending an action exists', async () => {
    const r = await understand(input('Achète mon billet de train'), 'OWNER', model({ mode: 'out_of_scope', confidence: 1 }))
    expect(r.type).toBe('unknown'); expect(r.action).toBeUndefined()
  })
  it('a model handoff still needs an affirmative current request and existing UI confirmation', async () => {
    const p = model({ mode: 'handoff', confidence: 1, toolId: 'create_quote' })
    const r = await understand(input('Je voudrais un document commercial pour ce client'), 'RECEPTIONIST', p)
    expect(r.action?.id).toBe('create_quote'); expect(r.action?.confirmationRequired).toBe(true)
    const rejected = await understand(input('Comment préparer ce document ?'), 'RECEPTIONIST', p)
    expect(rejected.action).toBeUndefined()
  })
  it('fallback remains local when a model throws', async () => {
    const p: LlmProvider = { id: 'scripted', name: 'Scripted', plan: async () => { throw new Error('network') } }
    const r = await understand(input('Stock bas'), 'RECEPTIONIST', p)
    expect(r.resolver).toBe('low_stock'); expect(r.planning?.fallback).toBeTruthy()
  })
  it('timeout of an unresponsive planner yields local response', async () => {
    vi.useFakeTimers()
    const pending = understand(input('Stock bas'), 'RECEPTIONIST', { id: 'scripted', name: 'Scripted', plan: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(3001)
    expect((await pending).resolver).toBe('low_stock')
  })
})
describe('controlled executor (scripted readers, not Prisma)', () => {
  it.each([
    [{ toolId: 'low_stock', input: { garageId: 'other' } }],
    [{ toolId: 'create_quote', input: {} }],
    [{ toolId: 'unknown', input: {} }],
    Array(4).fill({ toolId: 'low_stock', input: {} }),
    Array(2).fill({ toolId: 'low_stock', input: {} }),
  ])('rejects invalid whole plan before any reader: %j', async calls => {
    const reader = vi.fn(async () => verified)
    await expect(executeReadPlan(calls, 'OWNER', reader)).rejects.toThrow('invalid_plan')
    expect(reader).not.toHaveBeenCalled()
  })
  it('rejects a forbidden second read before even the first authorized read', async () => {
    const reader = vi.fn(async () => verified)
    await expect(executeReadPlan([{ toolId: 'low_stock', input: {} }, { toolId: 'margin', input: {} }], 'RECEPTIONIST', reader)).rejects.toThrow('forbidden')
    expect(reader).not.toHaveBeenCalled()
  })
  it('does not allow mechanic/unknown role global tools', () => {
    for (const role of ['MECHANIC', 'UNKNOWN']) expect(() => validateCall({ toolId: 'job_search', input: { reference: 'Fixture' } }, role)).toThrow('forbidden')
  })
  it('records two actual scripted invocations with verified outputs', async () => {
    const reader = vi.fn(async () => verified)
    const r = await executeReadPlan([{ toolId: 'low_stock', input: {} }, { toolId: 'today_revenue', input: {} }], 'OWNER', reader)
    expect(reader).toHaveBeenCalledTimes(2); expect(r.complete).toBe(true); expect(r.observations.every(o => o.verified)).toBe(true)
    expect(r.observations.map(o => o.observedAt)).toEqual([verified.execution!.observedAt, verified.execution!.observedAt])
  })
  it('never turns an unverified/error result into facts or a complete answer', async () => {
    const r = await executeReadPlan([{ toolId: 'low_stock', input: {} }], 'OWNER', async () => ({ ...verified, ancrage: { verifie: false } }))
    expect(r.complete).toBe(false); expect(r.observations[0].status).toBe('unverified'); expect(r.observations[0].data).toBeUndefined()
  })
  it('separates forecast estimates from business observations', async () => {
    const r = await executeReadPlan([{ toolId: 'forecast_revenue', input: {} }], 'OWNER', async () => verified)
    expect(r.observations[0].evidence).toBe('estimate')
  })
  it('marks not found as a verified empty lookup, not proof of no client', async () => {
    const r = await executeReadPlan([{ toolId: 'job_search', input: { reference: 'Fixture' } }], 'OWNER', async () => ({ ...verified, data: { jobs: [] } }))
    expect(r.observations[0].status).toBe('not_found')
  })
  it('aborts the dispatch signal on timeout and does not start a subsequent read', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const reader = vi.fn((_call: ToolCall, s: AbortSignal) => { signal = s; return new Promise<ReadResult>(() => {}) })
    const pending = executeReadPlan([{ toolId: 'low_stock', input: {} }, { toolId: 'today_revenue', input: {} }], 'OWNER', reader, { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(11)
    const r = await pending
    expect(signal?.aborted).toBe(true); expect(reader).toHaveBeenCalledTimes(1)
    expect(r.observations.map(o => o.status)).toEqual(['timeout', 'not_executed']); expect(r.complete).toBe(false)
  })
  it('does not dispatch at all after request cancellation', async () => {
    const c = new AbortController(); c.abort()
    const reader = vi.fn(async () => verified)
    const r = await executeReadPlan([{ toolId: 'low_stock', input: {} }], 'OWNER', reader, { signal: c.signal })
    expect(reader).not.toHaveBeenCalled(); expect(r.complete).toBe(false)
  })
  it('revalidates every schema including forbidden tenant/SQL extras', () => {
    expect(() => validateExecutionPlan([{ toolId: 'job_search', input: { reference: 'Fixture', sql: 'SELECT *' } }], 'OWNER')).toThrow()
  })
})
describe('cold local readiness snapshot with simulated probe, not startup integration', () => {
  it('model is optional but database and local registry are essential', async () => {
    const r = await inspectAvailability(async () => true, { state: 'unavailable', reason: 'off' })
    expect(r.operational).toBe(true); expect(r.mode).toBe('local'); expect(r.database).toBe('ready')
    expect(r.tools.reads).toBe(12); expect(r.tools.handoffs).toBe(5)
  })
  it('cannot claim operational if DB fails even when model is ready', async () => {
    const r = await inspectAvailability(async () => { throw new Error('DB down') }, { state: 'ready', reason: 'simulated' })
    expect(r.state).toBe('unavailable'); expect(r.operational).toBe(false)
  })
  it('times out a hanging essential probe', async () => {
    vi.useFakeTimers()
    const pending = inspectAvailability(() => new Promise(() => {}), { state: 'unavailable', reason: 'off' }, 10)
    await vi.advanceTimersByTimeAsync(11)
    expect((await pending).operational).toBe(false)
  })
})

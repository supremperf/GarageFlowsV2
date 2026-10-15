/** Semantic interpretation is UNTRUSTED input, not a permission, fact or executable plan.
 * One bounded model call can produce this IR; the backend alone binds user evidence,
 * validates constraints and chooses an executable subset of the closed catalogue.
 */
import { z } from 'zod'
import { can } from '@/lib/authz'
import { KNOWLEDGE, normalizeQuery } from './knowledge'
import { allowedTools, validateCall, type ToolCall } from './tools'
import { validateExecutionPlan } from './execution'
import { containsSecret, NeedsInput, periodMismatch, planningContext, previousReference, referenceIn } from './planning'
import { handleQuery } from './engine'
import type { ConversationInput } from './conversation'
import type { PlanningRequest } from './planning'

const Span = z.object({ start: z.number().int().min(0).max(499), end: z.number().int().min(1).max(500) }).strict().refine(s => s.end > s.start)
const Source = z.enum(['current', 'previous_user'])
const Period = z.enum(['unspecified', 'today', 'rolling_month', 'next_month', 'unsupported'])
export const SemanticSchema = z.object({
  version: z.literal(1),
  intent: z.enum(['explain', 'lookup', 'compare', 'diagnose', 'propose_action', 'clarify', 'out_of_scope', 'mixed']),
  confidence: z.number().finite().min(0).max(1),
  entities: z.array(z.object({ kind: z.enum(['plate', 'customer_name', 'vin', 'symptom', 'obd']), source: Source, span: Span.optional() }).strict()).max(5),
  constraints: z.object({ tenant: z.enum(['session', 'other']), relationship: z.enum(['independent', 'dependent']), negated: z.boolean() }).strict(),
  missing: z.array(z.enum(['reference', 'vin', 'symptom', 'period', 'objective'])).max(5),
  candidates: z.array(z.object({ toolId: z.string().min(1).max(60), source: Source, period: Period, status: z.enum(['unspecified', 'as_recorded', 'sent_unanswered', 'late_today', 'unsupported_filter']).default('unspecified'), span: Span.optional() }).strict()).max(3),
  articleIds: z.array(z.string().min(1).max(60)).max(3),
}).strict()
export type SemanticUnderstanding = z.infer<typeof SemanticSchema>
export interface SemanticRequest extends PlanningRequest {
  // Derived metadata only. No historical text, names, reference values or result data.
  recentTurns: { index: number; topics: string[]; referenceAvailable: boolean }[]
}
export type SemanticDecision =
  | { mode: 'read'; calls: ToolCall[]; interpretation: SemanticUnderstanding }
  | { mode: 'help'; articleIds: string[]; interpretation: SemanticUnderstanding }
  | { mode: 'handoff'; toolId: string; interpretation: SemanticUnderstanding }
  | { mode: 'clarify'; missing: 'reference' | 'vin' | 'symptom' | 'period' | 'objective'; interpretation: SemanticUnderstanding }
  | { mode: 'out_of_scope'; interpretation: SemanticUnderstanding }

export function semanticTurnMetadata(input: ConversationInput, role: string): SemanticRequest['recentTurns'] {
  const permitted = new Set([...allowedTools(role).map(t => t.id), ...planningArticles(role).map(id => `help:${id}`)])
  return input.history.slice(-6).map((h, index) => {
    const context = planningContext({ query: input.query, history: [h] })
    return { index, topics: context.topics.filter(t => permitted.has(t)), referenceAvailable: context.hasReference }
  })
}
function sliceEvidence(query: string, span: z.infer<typeof Span>): string {
  if (span.end > query.length) throw new Error('evidence_outside_question')
  const text = query.slice(span.start, span.end).trim()
  if (!text || containsSecret(text)) throw new Error('invalid_evidence')
  return text
}
function entityValue(ir: SemanticUnderstanding, kind: SemanticUnderstanding['entities'][number]['kind'], input: ConversationInput): string | undefined {
  const entities = ir.entities.filter(e => e.kind === kind)
  if (entities.length > 1) throw new NeedsInput(kind === 'vin' ? 'vin' : 'reference')
  const e = entities[0]
  if (!e) return undefined
  if (e.source === 'previous_user') {
    if (e.span) throw new Error('historical_span_not_available_to_model')
    if (kind === 'plate' || kind === 'customer_name') {
      const ref = previousReference(input)
      if (ref.ambiguous || !ref.value) throw new NeedsInput('reference')
      return ref.value
    }
    const previous = [...input.history].reverse().find(h => !containsSecret(h.content) && (kind === 'vin' ? !!handleQuery(h.content).slots.vin : handleQuery(h.content).intent === 'diagnostic'))
    if (!previous) throw new NeedsInput(kind === 'vin' ? 'vin' : 'symptom')
    return kind === 'vin' ? handleQuery(previous.content).slots.vin : kind === 'obd' ? handleQuery(previous.content).slots.obdCode : previous.content
  }
  if (!e.span) throw new Error('current_entity_requires_evidence_span')
  return sliceEvidence(input.query, e.span)
}
/** Produces a backend-owned plan only after all schema/entity/constraint/RBAC checks. */
export function compileSemanticUnderstanding(value: unknown, input: ConversationInput, role: string): SemanticDecision {
  const ir = SemanticSchema.parse(value)
  if (ir.confidence < 0.75 || containsSecret(input.query)) throw new Error('unusable_interpretation')
  // Validate EVERY span and candidate before selecting any operation, even unused entities.
  for (const e of ir.entities) {
    if (e.source === 'current' && !e.span) throw new Error('missing_entity_evidence')
    if (e.source === 'previous_user' && e.span) throw new Error('historical_span_not_available_to_model')
    if (e.span) sliceEvidence(input.query, e.span)
  }
  const tools = allowedTools(role)
  for (const c of ir.candidates) {
    if (!tools.some(t => t.id === c.toolId)) throw new Error('forbidden_or_unknown_candidate')
    if (c.span) { if (c.source !== 'current') throw new Error('invalid_candidate_span'); sliceEvidence(input.query, c.span) }
  }
  if (new Set(ir.candidates.map(c => c.toolId)).size !== ir.candidates.length || new Set(ir.articleIds).size !== ir.articleIds.length) throw new Error('duplicate_candidate')
  if (ir.constraints.tenant === 'other') return { mode: 'out_of_scope', interpretation: ir }
  if (ir.constraints.relationship === 'dependent' || ir.intent === 'mixed') return { mode: 'clarify', missing: 'objective', interpretation: ir }
  if (ir.missing.length) return { mode: 'clarify', missing: ir.missing[0], interpretation: ir }
  if (ir.intent === 'clarify' || (ir.constraints.negated && ir.intent !== 'explain')) return { mode: 'clarify', missing: 'objective', interpretation: ir }
  if (ir.intent === 'out_of_scope') {
    if (ir.candidates.length || ir.articleIds.length) throw new Error('inconsistent_scope')
    return { mode: 'out_of_scope', interpretation: ir }
  }
  if (ir.intent === 'explain') {
    if (ir.candidates.length || !ir.articleIds.length) throw new Error('inconsistent_explanation')
    // Same permission filter as the existing article response assembler.
    const permittedIds = new Set(planningArticles(role))
    if (ir.articleIds.some(id => !permittedIds.has(id))) throw new Error('forbidden_or_unknown_article')
    return { mode: 'help', articleIds: ir.articleIds, interpretation: ir }
  }
  if (ir.articleIds.length || !ir.candidates.length) throw new Error('inconsistent_operations')
  if (ir.intent === 'propose_action') {
    if (ir.candidates.length !== 1 || tools.find(t => t.id === ir.candidates[0].toolId)?.kind !== 'handoff') throw new Error('inconsistent_handoff')
    // Still a proposal only; affirmative request + existing UI/form checks apply separately.
    return { mode: 'handoff', toolId: ir.candidates[0].toolId, interpretation: ir }
  }
  // A model cannot crop away unsupported periods/qualifiers by choosing a tiny span.
  // If operation spans are used, require complete clause coverage, permitting only
  // punctuation/conjunction separators between non-overlapping current operations.
  if (ir.candidates.some(c => c.span)) {
    if (ir.candidates.some(c => !c.span || c.source !== 'current')) throw new Error('incomplete_operation_evidence')
    const spans = ir.candidates.flatMap(c => c.span ? [c.span] : []).sort((a, b) => a.start - b.start)
    let end = 0
    for (const span of spans) {
      const gap = input.query.slice(end, span.start).trim()
      if (span.start < end || (gap && !/^(?:(?:et aussi|ainsi que|et|puis)\b|[\s,;:.!?])+$/i.test(gap))) throw new Error('uncovered_or_overlapping_operation_evidence')
      end = span.end
    }
    if (input.query.slice(end).trim()) throw new Error('uncovered_operation_qualifier')
  }
  if (ir.intent === 'compare' && ir.candidates.length < 2) throw new NeedsInput('objective')
  if (ir.intent === 'diagnose' && ir.candidates.some(c => !['diagnostic', 'vin_decode'].includes(c.toolId))) throw new Error('inconsistent_diagnosis')
  const calls = ir.candidates.map(c => {
    const tool = tools.find(t => t.id === c.toolId)!
    if (tool.kind !== 'read') throw new Error('read_cannot_execute_handoff')
    const relevant = c.span ? sliceEvidence(input.query, c.span) : input.query
    if (c.period === 'unsupported' || periodMismatch(tool.id, relevant)) throw new NeedsInput('period')
    const fixedStatus: Record<string, string> = { job_search: 'as_recorded', pending_quotes: 'sent_unanswered', late_vehicles: 'late_today' }
    if (c.status !== 'unspecified' && fixedStatus[tool.id] !== c.status) throw new NeedsInput('objective')
    const fixedPeriod = tool.id === 'margin' ? 'rolling_month' : tool.period
    if (c.period !== 'unspecified' && fixedPeriod !== c.period) throw new NeedsInput('period')
    if (c.source === 'previous_user' && !['job_search','vin_decode','diagnostic'].includes(tool.id)) {
      const previous = [...input.history].reverse().find(h => handleQuery(h.content).intent === tool.id && !containsSecret(h.content))
      if (!previous) throw new NeedsInput('objective')
      if (periodMismatch(tool.id, previous.content)) throw new NeedsInput('period')
    }
    let params: Record<string, unknown> = {}
    if (tool.id === 'job_search') {
      const ref = referenceIn(input.query)
      if (ref.ambiguous) throw new NeedsInput('reference')
      const plate = entityValue(ir, 'plate', input)
      const name = entityValue(ir, 'customer_name', input)
      if (plate && name) throw new NeedsInput('reference')
      const entityReference = plate || name
      if (ref.value && entityReference && ref.value.toUpperCase().replace(/[- ]/g, '') !== entityReference.toUpperCase().replace(/[- ]/g, '')) throw new NeedsInput('reference')
      let reference = ref.value || plate || name
      if (!reference && c.source === 'previous_user') {
        const prior = previousReference(input)
        if (prior.ambiguous || !prior.value) throw new NeedsInput('reference')
        reference = prior.value
      }
      if (!reference) throw new NeedsInput('reference')
      if (plate) {
        const normalized = plate.toUpperCase().replace(/[- ]/g, '')
        if (!/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(normalized)) throw new Error('invalid_plate_evidence')
        reference = normalized.replace(/^([A-Z]{2})([0-9]{3})([A-Z]{2})$/, '$1-$2-$3')
      }
      if (name && !/^[\p{L}][\p{L}'’ -]{1,59}$/u.test(name)) throw new Error('invalid_name_evidence')
      params = { reference }
    } else if (tool.id === 'vin_decode') {
      const vin = entityValue(ir, 'vin', input) || handleQuery(input.query).slots.vin
      if (!vin) throw new NeedsInput('vin')
      if (handleQuery(input.query).slots.vin && handleQuery(input.query).slots.vin !== vin.toUpperCase()) throw new NeedsInput('vin')
      params = { vin: vin.toUpperCase() }
    } else if (tool.id === 'diagnostic') {
      const text = entityValue(ir, 'symptom', input) || input.query
      const code = entityValue(ir, 'obd', input) || handleQuery(input.query).slots.obdCode
      if (!code && normalizeQuery(text).split(' ').length <= 3) throw new NeedsInput('symptom')
      params = { text, ...(code ? { obdCode: code.toUpperCase() } : {}) }
    }
    return validateCall({ toolId: tool.id, input: params }, role)
  })
  return { mode: 'read', calls: validateExecutionPlan(calls, role), interpretation: ir }
}
function planningArticles(role: string): string[] { return KNOWLEDGE.filter(a => !a.permission || can(role, a.permission)).map(a => a.id) }

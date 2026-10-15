/** Constrained model plans. No SQL, endpoint, model-provided business value or write parameters. */
import { z } from 'zod'
import { KNOWLEDGE, normalizeQuery } from './knowledge'
import { allowedTools, validateCall, type ToolCall } from './tools'
import { handleQuery } from './engine'
import type { ConversationInput } from './conversation'
import { dossierReference } from './references'

const Score = z.number().finite().min(0).max(1)
const Selection = z.object({ toolId: z.string().min(1).max(60), source: z.enum(['current', 'previous_user']) }).strict()
export const PlanSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('read'), confidence: Score, calls: z.array(Selection).min(1).max(3) }).strict(),
  z.object({ mode: z.literal('help'), confidence: Score, articleIds: z.array(z.string().min(1).max(60)).min(1).max(3) }).strict(),
  z.object({ mode: z.literal('handoff'), confidence: Score, toolId: z.string().max(60) }).strict(),
  z.object({ mode: z.literal('clarify'), confidence: Score, missing: z.enum(['reference', 'vin', 'symptom', 'period', 'objective']) }).strict(),
  z.object({ mode: z.literal('out_of_scope'), confidence: Score }).strict(),
])
export type ModelPlan = z.infer<typeof PlanSchema>
export interface PlanningContext {
  topics: string[]; hasReference: boolean; referenceAmbiguous: boolean; hasVin: boolean; hasSymptom: boolean
}
export interface PlanningRequest { query: string; context: PlanningContext; tools: { id: string; title: string; kind: string; parameters: string; period?: string }[]; articles: { id: string; title: string }[] }
export function containsSecret(text: string): boolean { return /sk-ant-|-----BEGIN|(?:password|mot de passe|api[_ -]?key|secret)\s*[:=]/i.test(text) }
export function referenceIn(text: string): { value: string | null; ambiguous: boolean } {
  const plates = [...text.toUpperCase().matchAll(/\b[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}\b/g)].map(m => m[0].replace(/[- ]/g, ''))
  if (new Set(plates).size > 1) return { value: null, ambiguous: true }
  return { value: dossierReference(text), ambiguous: false }
}
export function previousReference(input: ConversationInput) {
  for (const h of [...input.history.slice(-6)].reverse()) {
    if (containsSecret(h.content)) continue
    const ref = referenceIn(h.content)
    if (ref.ambiguous || ref.value) return ref
  }
  return { value: null, ambiguous: false }
}
export function planningContext(input: ConversationInput): PlanningContext {
  const topics: string[] = []
  let hasVin = false; let hasSymptom = false
  for (const h of input.history.slice(-6)) {
    if (containsSecret(h.content)) continue
    const r = handleQuery(h.content)
    if (r.intent) topics.push(r.intent)
    if (/\b(dossier|intervention)\b/.test(normalizeQuery(h.content))) topics.push('job_search')
    hasVin ||= !!r.slots.vin
    hasSymptom ||= r.intent === 'diagnostic' && (!!r.slots.obdCode || normalizeQuery(h.content).split(' ').length > 3)
    const help = KNOWLEDGE.filter(a => a.keywords.some(k => normalizeQuery(h.content).includes(normalizeQuery(k))))
    topics.push(...help.map(a => `help:${a.id}`))
  }
  const ref = previousReference(input)
  return { topics: [...new Set(topics)].slice(-12), hasReference: !!ref.value, referenceAmbiguous: ref.ambiguous, hasVin, hasSymptom }
}
export const CLARIFICATIONS = {
  reference: 'Précisez une seule immatriculation ou un nom de client. Les résultats précédents ne sont pas réutilisés comme faits.',
  vin: 'Indiquez le VIN complet (17 caractères) à décoder.',
  symptom: 'Décrivez le symptôme ou fournissez un code défaut. Les pistes de diagnostic ne sont pas une certitude.',
  period: 'Cette période n’est pas prise en charge par cet indicateur du chat. CA et retards : aujourd’hui ; marge : fenêtre du dernier mois du moteur ; prévision : mois prochain. Précisez le besoin ou utilisez le rapport du logiciel.',
  objective: 'Précisez l’objectif, le module ou la lecture souhaitée. Une création doit être préparée séparément et confirmée dans son formulaire.',
}
export class NeedsInput extends Error {
  constructor(readonly missing: keyof typeof CLARIFICATIONS) { super('needs_input') }
}
export function periodMismatch(toolId: string, query: string): boolean {
  // Unit morphology is normalized for constraint checks, not intent classification.
  const n = normalizeQuery(query).replace(/\b(jours|semaines|annees|trimestres|semestres)\b/g, unit => unit.slice(0, -1))
  const days = n.match(/\b([0-9]+) jours?\b/)
  if (toolId === 'margin' && days) return true
  if (['today_revenue', 'late_vehicles'].includes(toolId)) return /\b(hier|semaine|mois|annee|demain|trimestre|semestre|202[0-9])\b|\b[2-9][0-9]* jours\b/.test(n)
  if (toolId === 'margin') return /\b(hier|aujourd hui|jour|semaine|annee|trimestre|semestre|calendaire|202[0-9])\b|\b(?:7|90|365) jours\b/.test(n)
  if (toolId === 'forecast_revenue') return /\b(demain|semaine|annee|202[0-9])\b|\b[2-9] mois\b/.test(n)
  return false
}
/** Only locally extracted user input can bind a parameter; all results must be freshly read. */
export function bindReadPlan(plan: Extract<ModelPlan, { mode: 'read' }>, input: ConversationInput, role: string): ToolCall[] {
  const tools = allowedTools(role)
  const keys = new Set<string>()
  return plan.calls.map(selection => {
    const tool = tools.find(t => t.id === selection.toolId && t.kind === 'read')
    if (!tool) throw new Error('forbidden_or_unknown_tool')
    const contextual = selection.source === 'previous_user'
    if (contextual && !/^(et |pour )|\b(son|sa|ses|celui|celle|ce|cette|cet|meme|precedent|precedente|avant)\b/.test(normalizeQuery(input.query))) throw new NeedsInput('objective')
    const segments = input.query.split(/\s+(?:et aussi|ainsi que|et|puis)\s+|[;,]/i)
    const relevant = plan.calls.length > 1 ? segments.find(s => handleQuery(s).intent === tool.id) ?? input.query : input.query
    if (periodMismatch(tool.id, relevant)) throw new NeedsInput('period')
    if (contextual && !['job_search', 'vin_decode', 'diagnostic'].includes(tool.id)) {
      const previous = [...input.history].reverse().find(h => !containsSecret(h.content) && handleQuery(h.content).intent === tool.id)
      if (!previous) throw new NeedsInput('objective')
      if (periodMismatch(tool.id, previous.content)) throw new NeedsInput('period')
    }
    let params: Record<string, unknown> = {}
    if (tool.id === 'job_search') {
      const current = referenceIn(input.query)
      const ref = current.value || current.ambiguous ? current : contextual ? previousReference(input) : current
      if (ref.ambiguous || !ref.value) throw new NeedsInput('reference')
      params = { reference: ref.value }
    } else if (tool.id === 'vin_decode' || tool.id === 'diagnostic') {
      const explicitVin = handleQuery(input.query).slots.vin
      const raw = contextual && !(tool.id === 'vin_decode' && explicitVin) ? [...input.history].reverse().find(h => !containsSecret(h.content) && (tool.id === 'vin_decode' ? !!handleQuery(h.content).slots.vin : handleQuery(h.content).intent === 'diagnostic'))?.content : input.query
      const slots = handleQuery(raw ?? '').slots
      if (tool.id === 'vin_decode') { if (new Set((raw ?? '').toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? []).size > 1) throw new NeedsInput('vin'); if (!slots.vin) throw new NeedsInput('vin'); params = { vin: slots.vin } }
      else {
        if (!raw || (!slots.obdCode && normalizeQuery(raw).split(' ').length <= 3)) throw new NeedsInput('symptom')
        params = { text: raw, ...(slots.obdCode ? { obdCode: slots.obdCode } : {}) }
      }
    }
    const call = validateCall({ toolId: tool.id, input: params }, role)
    const key = JSON.stringify(call)
    if (keys.has(key)) throw new Error('duplicate_tool')
    keys.add(key)
    return call
  })
}

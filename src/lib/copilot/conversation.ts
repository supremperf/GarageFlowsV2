/** Bounded, stateless orchestration. Client history is untrusted routing context, never facts/authority. */
import { z } from 'zod'
import { compileSemanticUnderstanding, semanticTurnMetadata, type SemanticDecision } from './semantic'
import { can, type Permission } from '@/lib/authz'
import { classifyIntent } from '@/lib/copilot-llm/classify'
import type { LlmProvider } from '@/lib/copilot-llm/types'
import { handleQuery } from './engine'
import { INTENTS } from './intents'
import { KNOWLEDGE, KNOWLEDGE_VERSION, normalizeQuery, searchKnowledge } from './knowledge'
import { prepareAction } from './actions'
import { allowedTools, responseForCall, toolDescriptions, type ToolCall } from './tools'
import { bindReadPlan, CLARIFICATIONS, containsSecret, NeedsInput, periodMismatch, PlanSchema, planningContext, referenceIn, type ModelPlan } from './planning'
import { withTimeout } from '@/lib/copilot-llm/timeout'
import type { CopilotResponse } from './types'
import { dossierReference } from './references'
export { dossierReference } from './references'

export const ConversationSchema = z.object({
  query: z.string().trim().min(1).max(500),
  history: z.array(z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(500) }).strict()).max(6).default([]),
}).strict()
export type ConversationInput = z.infer<typeof ConversationSchema>
export interface ConversationResponse extends CopilotResponse {
  processing?: { interpretation: 'validated_contract'; intent: string; planning: 'validated' | 'not_required'; execution: 'not_started' | 'not_required' | 'complete' | 'incomplete'; verification: 'pending' | 'not_required' | 'verified_observations' | 'not_confirmed'; response: 'pending' | 'assembled' }
  sources?: { id: string; title: string; path: string; version: string }[]
  understanding?: 'local' | 'llm'
  plan?: { calls: ToolCall[] }
  planning?: { source: 'local' | 'model'; fallback?: string }
}
export const ACTION_PERMISSIONS: Record<string, Permission> = {
  create_appointment: 'job:manage', create_quote: 'quote:manage', send_reminder: 'customer:manage',
  order_parts: 'stock:manage', generate_report: 'financial:read',
}
const READ_PERMISSIONS: Record<string, Permission> = {
  today_revenue: 'financial:read', margin: 'financial:read', top_clients: 'financial:read', forecast_revenue: 'financial:read',
  pending_quotes: 'quote:manage', late_vehicles: 'job:manage',
}
const HELP = /\b(comment|explique|aide|fonctionne|signifie|difference|utiliser)\b|\bou (trouver|est|sont|faire)\b|\ba quoi sert\b/
const DOSSIER = /\b(dossier|dossiers|intervention|interventions)\b/
const SEARCH = /\b(retrouve|retrouver|cherche|chercher|recherche|consulte|consulter|voir|etat|statut|bloque|bloquee)\b/

function clarify(message: string): ConversationResponse {
  return { type: 'clarify', intent: null, message, confidence: 'low', slots: {}, understanding: 'local' }
}
export async function understandLocal(input: ConversationInput, role: string, provider: LlmProvider | null): Promise<ConversationResponse> {
  const query = input.query
  const n = normalizeQuery(query)
  const previous = input.history.at(-1)?.content ?? ''
  if (/sk-ant-|-----BEGIN|(?:password|mot de passe|api[_ -]?key|secret)\s*[:=]/i.test(query)) {
    return clarify('Ne communiquez pas de secret dans le chat. Cette demande n’a pas été transmise au modèle ; utilisez Nouvelle conversation pour l’effacer du panneau. Si un secret réel a été partagé, faites-le révoquer par la procédure autorisée.')
  }
  // Never interpret yes/no as consent to execute or reuse an old action.
  if (/^(oui|non|ok|confirme|vas y|fais le|annule|continue)$/.test(n)) {
    return clarify('Utilisez les boutons de la proposition pour ouvrir ou annuler le formulaire. Aucune opération n’a été effectuée. Pour une lecture, précisez la question ou le dossier à consulter à nouveau.')
  }
  const followup = /^(et |pour |comment |ou )/.test(n)
  const isHelp = HELP.test(n) || (followup && HELP.test(normalizeQuery(previous)))
  if (isHelp) {
    let articles = searchKnowledge(query, role)
    if (!articles.length && followup && previous) articles = searchKnowledge(previous, role)
    if (!articles.length) return clarify('Précisez le module à expliquer : planning, devis, clients, stock, diagnostic ou rapports. Certaines rubriques dépendent de vos droits.')
    return { type: 'answer', intent: null, message: articles.map(a => `${a.title} — ${a.text}`).join('\n\n'),
      confidence: 'high', slots: {}, understanding: 'local',
      sources: articles.map(a => ({ id: a.id, title: a.title, path: a.source.path, version: KNOWLEDGE_VERSION })) }
  }
  const dossierFollowup = followup && DOSSIER.test(normalizeQuery(previous)) && /\b(son|sa|ses|celui|celle|retard|statut|bloque)\b/.test(n)
  if ((DOSSIER.test(n) && SEARCH.test(n)) || dossierFollowup) {
    if (!can(role, 'job:manage')) return clarify('Votre rôle ne permet pas la recherche globale d’interventions.')
    const reference = dossierReference(query) ?? (dossierFollowup ? dossierReference(previous) : null)
    if (!reference) return clarify('Indiquez l’immatriculation (ex. AB-123-CD) ou le nom du client : « retrouve le dossier de Dupont ».')
    return { type: 'answer', intent: null, resolver: 'job_search', message: '', confidence: 'medium', slots: { text: reference }, understanding: 'local' }
  }
  const local = handleQuery(query)
  // A negative instruction must not become an affirmative action proposal.
  if (local.type === 'action_proposal' && /\b(ne|pas|jamais|annule|annuler|sans|supprime|supprimer)\b/.test(n)) {
    return clarify('Aucune action effectuée. Précisez si vous souhaitez consulter des données ou obtenir de l’aide ; la suppression n’est pas disponible dans ce chat.')
  }
  if (local.type === 'action_proposal') {
    const permission = local.intent && ACTION_PERMISSIONS[local.intent]
    if (!permission || !can(role, permission)) return clarify('Votre rôle ne permet pas de préparer cette opération.')
  }
  if (local.type !== 'unknown') return { ...local, understanding: 'local' }
  // Model may only choose a READ from this closed, permission-filtered catalogue.
  // Slots and facts are never accepted from the model. Action selection stays local + explicit.
  const allowed = INTENTS.filter(i => i.kind === 'read' && (!READ_PERMISSIONS[i.id] || can(role, READ_PERMISSIONS[i.id])))
  if (provider) {
    const result = await classifyIntent(query, allowed.map(i => ({ id: i.id, label: i.keywords[0], keywords: i.keywords })), provider, { timeoutMs: 3000 })
    const chosen = allowed.find(i => i.id === result.intentId)
    if (result.source === 'llm' && result.confidence >= 0.75 && chosen) {
      return { type: 'answer', intent: chosen.id, resolver: chosen.resolver, message: '', confidence: 'medium',
        slots: handleQuery(query).slots, understanding: 'llm' }
    }
  }
  return { ...local, message: 'Je ne peux pas répondre avec certitude. Donnez le module, la période ou une référence. Je peux expliquer le logiciel, consulter ses indicateurs disponibles et retrouver une intervention, mais pas modifier ou supprimer un dossier dans le chat.', understanding: 'local' }
}

function articlesResponse(ids: string[], role: string): ConversationResponse {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate_article')
  const articles = ids.map(id => KNOWLEDGE.find(a => a.id === id && (!a.permission || can(role, a.permission))))
  if (articles.some(a => !a)) throw new Error('forbidden_or_unknown_article')
  return { type: 'answer', intent: null, message: articles.map(a => `${a!.title} — ${a!.text}`).join('\n\n'), confidence: 'high', slots: {},
    sources: articles.map(a => ({ id: a!.id, title: a!.title, path: a!.source.path, version: KNOWLEDGE_VERSION })) }
}
function plannedResponse(calls: ToolCall[], source: 'local' | 'model'): ConversationResponse {
  return { ...(calls.length === 1 ? responseForCall(calls[0]) : { type: 'answer' as const, intent: null, confidence: 'medium' as const, slots: {}, message: '', resolver: 'plan' }),
    plan: { calls }, understanding: source === 'model' ? 'llm' : 'local', planning: { source } }
}
function localAliases(query: string): string {
  return normalizeQuery(query).replace(/\bstoc\b/g, 'stock').replace(/\bbenef\b/g, 'benefice')
    .replace(/\bdevis qui attendent\b/g, 'devis en attente').replace(/\bpieces (?:qui|ki) manquent\b/g, 'pieces manquantes')
    .replace(/\bmecanos (?:sont )?dispo\b/g, 'mecaniciens disponibles')
}
function applyPlan(plan: ModelPlan, input: ConversationInput, role: string): ConversationResponse {
  if (plan.mode === 'read') return plannedResponse(bindReadPlan(plan, input, role), 'model')
  if (plan.mode === 'help') return { ...articlesResponse(plan.articleIds, role), planning: { source: 'model' }, understanding: 'llm' }
  if (plan.mode === 'clarify') return { ...clarify(CLARIFICATIONS[plan.missing]), planning: { source: 'model' } }
  if (plan.mode === 'out_of_scope') return { type: 'unknown', intent: null, confidence: 'high', slots: {}, message: 'Cette demande dépasse le périmètre GarageFlows ou les outils disponibles. Je peux expliquer le logiciel et consulter les lectures autorisées, mais pas exécuter du code, du SQL ou des opérations générales.', planning: { source: 'model' } }
  const tool = allowedTools(role).find(t => t.id === plan.toolId && t.kind === 'handoff')
  const n = normalizeQuery(input.query)
  // A model proposal is NOT authorization/consent. Require an affirmative current request.
  if (!tool?.intent || /\b(comment|explique|aide|ne|pas|sans|jamais|annule|supprime)\b/.test(n)
    || !/\b(cree|creer|prepare|preparer|planifie|planifier|envoie|envoyer|relance|commander|commande|genere|generer|ouvre|ouvrir|veux|voudrais)\b/.test(n)) throw new NeedsInput('objective')
  const action = prepareAction(tool.intent, handleQuery(input.query).slots)
  if (!action) throw new Error('unknown_handoff')
  return { type: 'action_proposal', intent: tool.intent, message: `Souhaitez-vous ouvrir l’outil pour : ${action.summary} ? Rien n’est enregistré ni envoyé par le chat.`, confidence: 'medium', slots: {}, action, planning: { source: 'model' }, understanding: 'llm' }
}
function responseForSemantic(decision: SemanticDecision, input: ConversationInput, role: string): ConversationResponse {
  const ir = decision.interpretation
  let response: ConversationResponse
  if (decision.mode === 'read') response = plannedResponse(decision.calls, 'model')
  else if (decision.mode === 'help') response = { ...articlesResponse(decision.articleIds, role), understanding: 'llm', planning: { source: 'model' } }
  else if (decision.mode === 'clarify') response = { ...clarify(CLARIFICATIONS[decision.missing]), planning: { source: 'model' } }
  else response = applyPlan(decision.mode === 'handoff' ? { mode: 'handoff', toolId: decision.toolId, confidence: ir.confidence } : { mode: 'out_of_scope', confidence: ir.confidence }, input, role)
  // Only enums/stages cross into telemetry, never raw entities/spans/constraints/history.
  return { ...response, processing: { interpretation: 'validated_contract', intent: ir.intent, planning: decision.mode === 'read' ? 'validated' : 'not_required', execution: decision.mode === 'read' ? 'not_started' : 'not_required', verification: decision.mode === 'read' ? 'pending' : 'not_required', response: decision.mode === 'read' ? 'pending' : 'assembled' } }
}
/** Phase-1 paths remain the offline fallback. Production planning is independently schema/RBAC validated. */
export async function understand(input: ConversationInput, role: string, provider: LlmProvider | null, options: { signal?: AbortSignal } = {}): Promise<ConversationResponse> {
  // Validate even direct/internal callers; HTTP validation is not the only boundary.
  input = ConversationSchema.parse(input)
  if (options.signal?.aborted) return clarify('Demande interrompue ; aucune nouvelle lecture effectuée.')
  const original = await understandLocal(input, role, null)
  const n = normalizeQuery(input.query)
  const hardGuard = containsSecret(input.query) || /^(oui|non|ok|confirme|vas y|fais le|annule|continue)$/.test(n)
    || (original.type === 'clarify' && /\b(ne|pas|jamais|sans|annule|supprime)\b/.test(n))
  if (hardGuard || original.type === 'action_proposal') return original
  if (referenceIn(input.query).ambiguous && /\b(dossier|intervention)\b/.test(n)) return clarify(CLARIFICATIONS.reference)
  // Preserve the financial denial path (403 from HTTP) instead of asking a model to bypass it.
  if (original.intent && ['margin', 'today_revenue', 'top_clients', 'forecast_revenue'].includes(original.intent) && !can(role, 'financial:read')) return original
  let fallback = original
  // A prior explanation must not turn an explicit current status lookup into help.
  if (original.sources && DOSSIER.test(n) && SEARCH.test(n) && !HELP.test(n)) {
    try {
      const plan: Extract<ModelPlan, { mode: 'read' }> = { mode: 'read', confidence: 1, calls: [{ toolId: 'job_search', source: referenceIn(input.query).value ? 'current' : 'previous_user' }] }
      fallback = plannedResponse(bindReadPlan(plan, input, role), 'local')
    } catch (e) { fallback = clarify(e instanceof NeedsInput ? CLARIFICATIONS[e.missing] : CLARIFICATIONS.reference) }
  }
  // Preserve unsupported historical period constraints for local follow-ups too.
  if (fallback.intent && input.history.length && /^(et |pour )|\b(meme|precedent|precedente)\b/.test(n)
    && ['margin', 'today_revenue', 'forecast_revenue', 'late_vehicles'].includes(fallback.intent)) {
    try { bindReadPlan({ mode: 'read', confidence: 1, calls: [{ toolId: fallback.intent, source: 'previous_user' }] }, input, role) }
    catch (e) { if (e instanceof NeedsInput && e.missing === 'period') fallback = clarify(CLARIFICATIONS.period) }
  }
  if (fallback.type === 'unknown') {
    const alias = localAliases(input.query)
    if (alias !== n) fallback = await understandLocal({ ...input, query: alias }, role, null)
  }
  const parts = input.query.split(/\s+(?:et aussi|ainsi que|et|puis)\s+|;/i).filter(Boolean).flatMap(part => {
    const commaParts = part.split(',').filter(p => p.trim())
    // Expand commas only when ALL subclauses are known independent reads.
    // Preserve qualifiers in a clause instead of inventing an extra tool request.
    return commaParts.length > 1 && commaParts.every(p => { const r = handleQuery(localAliases(p)); return r.type === 'answer' && !!r.intent }) ? commaParts : [part]
  })
  if (parts.length > 1 && !original.sources) {
    const reads = parts.map(part => handleQuery(localAliases(part)))
    if (reads.every(r => r.type === 'answer' && r.intent)) {
      try {
        const model: Extract<ModelPlan, { mode: 'read' }> = { mode: 'read', confidence: 1, calls: reads.map(r => ({ toolId: r.intent!, source: 'current' })) }
        // Schema enforces max three; every permission/parameter checked before execution.
        fallback = plannedResponse(bindReadPlan(PlanSchema.parse(model) as typeof model, input, role), 'local')
      } catch (e) { fallback = clarify(e instanceof NeedsInput ? CLARIFICATIONS[e.missing] : CLARIFICATIONS.objective) }
    } else fallback = clarify(CLARIFICATIONS.objective)
  }
  if (fallback.type === 'unknown' && /\bca\b/.test(n) && periodMismatch('today_revenue', input.query)) fallback = clarify(CLARIFICATIONS.period)
  if (fallback.intent && periodMismatch(fallback.intent, input.query)) fallback = clarify(CLARIFICATIONS.period)
  if (provider?.interpret || provider?.plan) {
    try {
      const permittedArticles = KNOWLEDGE.filter(a => !a.permission || can(role, a.permission))
      const context = planningContext(input)
      const permittedIds = new Set(allowedTools(role).map(t => t.id))
      const articleIds = new Set(permittedArticles.map(a => `help:${a.id}`))
      context.topics = context.topics.filter(t => permittedIds.has(t) || articleIds.has(t))
      // Only derived topic IDs/parameter availability cross the boundary, never historical text/PII/results.
      const request = { query: input.query, context, tools: toolDescriptions(role), articles: permittedArticles.map(a => ({ id: a.id, title: a.title })) }
      if (provider.interpret) {
        const interpretation = await withTimeout(provider.interpret({ ...request, recentTurns: semanticTurnMetadata(input, role) }, options), 3000)
        if (options.signal?.aborted) return clarify('Demande interrompue ; aucune nouvelle lecture effectuée.')
        try { return responseForSemantic(compileSemanticUnderstanding(interpretation, input, role), input, role) }
        catch (e) { if (e instanceof NeedsInput) return { ...clarify(CLARIFICATIONS[e.missing]), planning: { source: 'model' } }; throw e }
      }
      // Compatibility seam only: production uses interpret, never a second request after invalid IR.
      const candidate = await withTimeout(provider.plan!(request, options), 3000)
      if (options.signal?.aborted) return clarify('Demande interrompue ; aucune nouvelle lecture effectuée.')
      const parsed = PlanSchema.safeParse(candidate)
      if (parsed.success && parsed.data.confidence >= 0.75) {
        try { return applyPlan(parsed.data, input, role) }
        catch (e) { if (e instanceof NeedsInput) return { ...clarify(CLARIFICATIONS[e.missing]), planning: { source: 'model' } }; throw e }
      }
    } catch { /* Invalid/network/timeout plan cannot execute any tool; preserve bounded local fallback. */ }
    return { ...fallback, planning: { source: 'local', fallback: 'model_unavailable_or_invalid' } }
  }
  // Existing third-party/scripted classify seam is retained, but only for the old unknown path.
  if (provider?.classify && fallback.type === 'unknown') return understandLocal(input, role, provider)
  return { ...fallback, planning: { source: 'local' } }
}

/** Bounded, stateless orchestration. Client history is untrusted routing context, never facts/authority. */
import { z } from 'zod'
import { can, type Permission } from '@/lib/authz'
import { classifyIntent } from '@/lib/copilot-llm/classify'
import type { LlmProvider } from '@/lib/copilot-llm/types'
import { handleQuery } from './engine'
import { INTENTS } from './intents'
import { KNOWLEDGE_VERSION, normalizeQuery, searchKnowledge } from './knowledge'
import type { CopilotResponse } from './types'

export const ConversationSchema = z.object({
  query: z.string().trim().min(1).max(500),
  history: z.array(z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(500) }).strict()).max(6).default([]),
}).strict()
export type ConversationInput = z.infer<typeof ConversationSchema>
export interface ConversationResponse extends CopilotResponse {
  sources?: { id: string; title: string; path: string; version: string }[]
  understanding?: 'local' | 'llm'
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
export function dossierReference(query: string): string | null {
  const plate = query.toUpperCase().match(/\b[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}\b/)
  if (plate) return plate[0].replace(/[- ]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3')
  const named = query.match(/\b(?:client(?:e)?|nom|dossier(?:\s+(?:de|du|pour))?)\s+([\p{L}][\p{L}'’ -]{1,59})$/iu)
  if (!named) return null
  const ref = named[1].trim()
  if (/^(ce |cette |le |la |les |du |de |client$|intervention$)/i.test(ref)) return null
  return ref.length >= 2 ? ref : null
}
function clarify(message: string): ConversationResponse {
  return { type: 'clarify', intent: null, message, confidence: 'low', slots: {}, understanding: 'local' }
}
export async function understand(input: ConversationInput, role: string, provider: LlmProvider | null): Promise<ConversationResponse> {
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

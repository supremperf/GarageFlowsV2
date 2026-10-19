/** Cold-start validation runs once per module load, not a training/index rebuild. */
import { KNOWLEDGE, KNOWLEDGE_VERSION } from './knowledge'
import { TOOLS } from './tools'
import { withTimeout } from '@/lib/copilot-llm/timeout'
import type { ProviderHealth } from '@/lib/copilot-llm/provider'
const localReady = KNOWLEDGE.length > 0 && new Set(KNOWLEDGE.map(a => a.id)).size === KNOWLEDGE.length && KNOWLEDGE.every(a => a.text && a.source.path && a.source.anchor)
const toolsReady = TOOLS.length > 0 && new Set(TOOLS.map(t => t.id)).size === TOOLS.length && TOOLS.every(t => t.schema && t.title && t.verification && (t.kind === 'handoff' || t.resolver))
export async function inspectAvailability(probeGarage: () => Promise<boolean>, model: ProviderHealth, timeoutMs = 1000) {
  let database = false
  try { database = await withTimeout(Promise.resolve().then(probeGarage), timeoutMs) === true } catch { /* Never claim DB ready after error or timeout. */ }
  const operational = localReady && toolsReady && database
  return { state: !operational ? 'unavailable' : model.state === 'ready' || model.state === 'unavailable' ? 'ready' : 'degraded', operational,
    mode: model.state === 'ready' ? 'model-assisted' : 'local',
    local: { state: localReady ? 'ready' : 'unavailable', knowledgeVersion: KNOWLEDGE_VERSION, articles: KNOWLEDGE.length },
    tools: { state: toolsReady ? 'ready' : 'unavailable', reads: TOOLS.filter(t => t.kind === 'read').length, handoffs: TOOLS.filter(t => t.kind === 'handoff').length },
    database: database ? 'ready' : 'unavailable', model, checkedAt: new Date().toISOString(),
    message: operational ? 'Dépendances locales et accès au garage confirmés à cet instant ; chaque lecture métier reste vérifiée séparément.' : 'Dépendance essentielle indisponible ; disponibilité opérationnelle non confirmée.' }
}

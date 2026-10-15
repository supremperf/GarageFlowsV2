export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { ConversationSchema, understand } from '@/lib/copilot/conversation'
import { inspectAvailability } from '@/lib/copilot/readiness'
import { providerHealth } from '@/lib/copilot-llm/provider'
import { can } from '@/lib/authz'
import { resolveLlmProvider } from '@/lib/copilot-llm'
import { resolveBusinessRead, probeAuthorizedDependencies } from '@/lib/copilot/server-readers'
import { executeReadPlan, ToolPolicyError } from '@/lib/copilot/execution'
import { responseForCall } from '@/lib/copilot/tools'
// Authenticated readiness snapshot: no paid probe, no credential exposure.
export const GET = withAuth(async () => {
  const session = await requireSession()
  const status = await inspectAvailability(() => probeAuthorizedDependencies(session.user.garageId, session.user.role), providerHealth())
  return NextResponse.json(status, { status: status.operational ? 200 : 503, headers: { 'Cache-Control': 'private, no-store' } })
})

// Résolveurs exposant des données FINANCIÈRES (CA, marge, revenu par client,
// prévision de CA) — réservés à financial:read (OWNER/MANAGER). Les intentions
// opérationnelles (mécaniciens dispo, VIN, diagnostic, retards…) restent
// ouvertes à tous les rôles authentifiés.
const FINANCIAL_RESOLVERS = new Set(['margin', 'revenue_today', 'top_clients', 'forecast'])

// POST /api/copilot — conversational routing over the platform's engines.
// Read intents are answered with real data; action intents return a
// confirmation-gated proposal (the copilot NEVER performs a write itself).
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const rl = await enforceRateLimit('api', `copilot:${garageId}`, { max: 60, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  // Bound actual streamed bytes, not just an optional Content-Length header.
  const reader = req.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Corps JSON requis' }, { status: 400 })
  let raw = ''
  let bytes = 0
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 20000) { await reader.cancel(); return NextResponse.json({ error: 'Demande trop volumineuse' }, { status: 413 }) }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } finally { reader.releaseLock() }
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const parsed = ConversationSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Demande ou contexte invalide (question : 500 caractères, historique : 6 questions maximum).' }, { status: 400 })

  const res = await understand(parsed.data, session.user.role, resolveLlmProvider(), { signal: req.signal })

  if (req.signal.aborted) return NextResponse.json({ error: 'Demande interrompue ; aucune nouvelle lecture effectuée.' }, { status: 408 })

  // Actions & unknown pass through unchanged (actions require confirmation).
  if (res.type !== 'answer' || !res.resolver) return NextResponse.json(res)

  // Contrôle d'accès financier : une intention financière posée par un rôle sans
  // financial:read est refusée (pas de fuite de CA/marge via le copilote).
  if (FINANCIAL_RESOLVERS.has(res.resolver) && !can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé : données financières réservées.' }, { status: 403 })
  }

  const context = { garageId, role: session.user.role, query: parsed.data.query }
  try {
    if (!res.plan) return NextResponse.json(await resolveBusinessRead(res, context))
    const result = await executeReadPlan(res.plan.calls, context.role,
      call => resolveBusinessRead(responseForCall(call), context), { signal: req.signal })
    const statuses = { success: 'lecture effectuée', not_found: 'aucun résultat', needs_input: 'précision nécessaire', error: 'lecture indisponible', timeout: 'délai dépassé', aborted: 'interrompue', not_executed: 'non exécutée', unverified: 'résultat non confirmé' }
    const evidence = { business_read: 'observation métier', estimate: 'estimation', hypothesis: 'piste de diagnostic', decode: 'décodage' }
    const message = result.observations.map(o => `${o.title} — ${statuses[o.status]} (${evidence[o.evidence]})\n${o.message}`).join('\n\n')
    return NextResponse.json({ ...res, message, phrasing: message, data: { results: result.observations },
      ...(res.processing ? { processing: { ...res.processing, execution: result.complete ? 'complete' : 'incomplete', verification: result.complete ? 'verified_observations' : 'not_confirmed', response: 'assembled' } } : {}),
      execution: result, ancrage: { verifie: result.complete && result.observations.every(o => o.evidence === 'business_read'), source: 'fallback' },
      model: providerHealth() })
  } catch (e) {
    if (e instanceof ToolPolicyError) return NextResponse.json({ error: e.code === 'forbidden' ? 'Accès refusé' : 'Plan de lecture invalide' }, { status: e.code === 'forbidden' ? 403 : 400 })
    return NextResponse.json({ error: 'Lecture indisponible ; aucun résultat confirmé.' }, { status: 503 })
  }
})

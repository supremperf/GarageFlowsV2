/** Executes only validated independent reads. Injected reader is backend-owned, never user/model code. */
import { z } from 'zod'
import { TOOLS, validateCall, type ToolCall } from './tools'
import type { CopilotResponse } from './types'
export interface ReadResult extends CopilotResponse {
  phrasing?: string
  ancrage?: { verifie: boolean; source?: string }
  execution?: { status: string; readOnly: boolean; observedAt: string; resolver?: string }
}
export interface ToolObservation {
  toolId: string; title: string
  status: 'success' | 'not_found' | 'needs_input' | 'error' | 'timeout' | 'aborted' | 'not_executed' | 'unverified'
  verified: boolean; evidence: 'business_read' | 'estimate' | 'hypothesis' | 'decode'
  observedAt?: string; durationMs: number; message: string; data?: unknown
}
export class ToolPolicyError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_plan') { super(code) }
}
export function validateExecutionPlan(value: unknown, role: string): ToolCall[] {
  try {
    const list = z.array(z.unknown()).min(1).max(3).parse(value)
    const calls = list.map(c => validateCall(c, role))
    if (new Set(calls.map(c => JSON.stringify(c))).size !== calls.length) throw new Error('duplicate')
    return calls
  } catch (e) { throw new ToolPolicyError(e instanceof Error && e.message === 'forbidden' ? 'forbidden' : 'invalid_plan') }
}
async function boundedRead(call: ToolCall, reader: (call: ToolCall, signal: AbortSignal) => Promise<ReadResult>, ms: number, parent?: AbortSignal): Promise<ReadResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new Error('aborted')) }
    parent?.addEventListener('abort', onAbort, { once: true })
    if (parent?.aborted) { onAbort(); return }
    timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, ms)
  })
  try { return await Promise.race([deadline, Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error('aborted'); return reader(call, controller.signal) })]) }
  finally { clearTimeout(timer); if (onAbort) parent?.removeEventListener('abort', onAbort) }
}
export async function executeReadPlan(calls: unknown, role: string, reader: (call: ToolCall, signal: AbortSignal) => Promise<ReadResult>, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  // Validate ALL calls before dispatching ANY: no partial permission bypass.
  const validated = validateExecutionPlan(calls, role)
  const observations: ToolObservation[] = []
  let stopped = false
  for (const call of validated) {
    const tool = TOOLS.find(t => t.id === call.toolId)!
    const evidence = call.toolId === 'forecast_revenue' ? 'estimate' : call.toolId === 'diagnostic' ? 'hypothesis' : call.toolId === 'vin_decode' ? 'decode' : 'business_read'
    const start = performance.now()
    let item: ToolObservation = { toolId: call.toolId, title: tool.title, status: 'not_executed', verified: false, evidence, durationMs: 0, message: 'Lecture non exécutée après interruption.' }
    if (!stopped && !options.signal?.aborted) {
      try {
        // Recheck immediately before each read, even after whole-plan validation.
        validateCall(call, role)
        const r = await boundedRead(call, reader, Math.min(5000, Math.max(1, options.timeoutMs ?? 3500)), options.signal)
        const verified = r.ancrage?.verifie === true && r.execution?.status === 'completed' && r.execution.readOnly === true && (!r.execution.resolver || r.execution.resolver === tool.resolver) && r.data != null
        const emptyJobs = call.toolId === 'job_search' && !!r.data && Array.isArray((r.data as { jobs?: unknown }).jobs) && (r.data as { jobs: unknown[] }).jobs.length === 0
        const status = r.execution?.status === 'failed' ? 'error' : r.type === 'clarify' || r.execution?.status === 'needs_input' ? 'needs_input' : !verified ? 'unverified' : emptyJobs ? 'not_found' : 'success'
        item = { ...item, status, verified, observedAt: verified && r.execution?.observedAt && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(r.execution.observedAt) && Number.isFinite(Date.parse(r.execution.observedAt)) ? r.execution.observedAt : undefined, message: verified ? r.phrasing || r.message || 'Résultat sans formulation.' : status === 'needs_input' ? 'Précisez les paramètres nécessaires à cette lecture.' : 'Lecture non confirmée ; aucun détail de résultat exposé.', ...(verified ? { data: r.data } : {}) }
      } catch (e) {
        const code = e instanceof Error && ['timeout', 'aborted'].includes(e.message) ? e.message as 'timeout' | 'aborted' : 'error'
        item = { ...item, status: code, message: code === 'timeout' ? 'Délai de lecture dépassé ; résultat non confirmé.' : code === 'aborted' ? 'Lecture interrompue ; résultat non confirmé.' : 'Lecture indisponible ; résultat non confirmé.' }
        stopped = code === 'timeout' || code === 'aborted'
      }
    }
    item.durationMs = performance.now() - start
    observations.push(item)
  }
  return { readOnly: true as const, complete: observations.every(o => o.verified), observations, observedAt: new Date().toISOString() }
}

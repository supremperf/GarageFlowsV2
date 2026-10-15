'use strict'
/** New DEVELOPMENT formulations. No scripted model responses. SQL/real business evaluation
 * is deliberately NOT inferred from a selected tool. No confidential response text in report.
 */
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const live = args.includes('--live')
const rawRouter = args.includes('--router')
const approved = args.includes('--approve-paid')
const capArg = args.find(a => a.startsWith('--max-calls='))
const cap = capArg ? Number(capArg.split('=')[1]) : 0
if (args.some(a => !['--live','--router','--approve-paid','--preflight'].includes(a) && !/^--max-calls=\d+$/.test(a))) throw new Error('Unknown argument')
const configuration = { explicitAnthropic: process.env.GARAGEFLOW_LLM === 'anthropic', keyPresent: !!process.env.ANTHROPIC_API_KEY?.trim(), modelPresent: !!process.env.GARAGEFLOW_LLM_MODEL }
if (args.includes('--preflight')) {
  console.log(JSON.stringify({ configuration, networkAttempted: false, paidApprovalGivenToRunner: approved,
    status: 'PENDING live approval/configuration/egress validation', limits: 'Presence only, no key values/profile loading/provider call. No authentication or model availability established.' }, null, 2))
} else if (live && (rawRouter || !approved || !Number.isInteger(cap) || cap < 1 || cap > 24 || !configuration.explicitAnthropic || !configuration.keyPresent)) {
  console.error('Live evaluation blocked: explicit approval flag, cap 1..24, GARAGEFLOW_LLM=anthropic and server-injected key required. No call made.')
  process.exitCode = 2
} else {
  const { loader } = require('./evaluate-copilot.cjs')
  const load = loader(false)
  const { understand } = load('src/lib/copilot/conversation.ts')
  const { handleQuery } = load('src/lib/copilot/engine.ts')
  const { TOOLS, validateCall, allowedTools } = load('src/lib/copilot/tools.ts')
  const { validateExecutionPlan } = load('src/lib/copilot/execution.ts')
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/copilot/evaluation-phase3.json'), 'utf8'))
  const previous = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/copilot/evaluation-cases.json'), 'utf8'))
  if (cases.some(c => previous.some(p => p.query === c.query)) || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Corpus overlap or duplicate IDs')
  let attempts = 0, acceptedPlans = 0
  const modelTimes = []
  const provider = live ? load('src/lib/copilot-llm/provider.ts').resolveLlmProvider() : null
  if (live && !provider?.plan) throw new Error('No explicitly configured planner')
  const controlled = provider ? { id: provider.id, name: provider.name, plan: async (request, options) => {
    if (++attempts > cap) throw new Error('Evaluation call cap reached')
    const start = performance.now()
    const result = await provider.plan(request, options)
    modelTimes.push(performance.now() - start)
    if (result) acceptedPlans++
    return result
  } } : null
  const stats = samples => {
    if (!samples.length) return { samples: 0, medianMs: null, p95Ms: null }
    const a = [...samples].sort((a,b) => a-b)
    return { samples: a.length, medianMs: a[Math.floor(a.length*.5)], p95Ms: a[Math.min(a.length-1,Math.floor(a.length*.95))] }
  }
  ;(async () => {
    const rows = [], times = []
    let unneededClarifications = 0, toolSelectionErrors = 0, invalidPlans = 0, prematureFactPayloads = 0, correctDenials = 0, denialCases = 0
    for (const test of live ? cases.slice(0, cap) : cases) {
      const start = performance.now()
      const r = rawRouter ? handleQuery(test.query) : await understand({ query: test.query, history: test.history.map(content => ({ role: 'user', content })) }, test.role, controlled)
      times.push(performance.now()-start)
      const legacy = TOOLS.find(t => t.kind === 'read' && t.resolver === r.resolver)
      const toolIds = r.plan?.calls.map(c => c.toolId) ?? (r.type === 'answer' && legacy ? [legacy.id] : [])
      let type = r.sources?.length ? 'help' : r.type
      let policyDenied = false
      if (r.plan) {
        try { validateExecutionPlan(r.plan.calls, test.role) } catch { invalidPlans++; policyDenied = true }
      } else if (legacy && r.type === 'answer') {
        const params = legacy.id === 'job_search' ? { reference: r.slots.text } : legacy.id === 'vin_decode' ? { vin: r.slots.vin } : legacy.id === 'diagnostic' ? { text: test.query, ...(r.slots.obdCode ? { obdCode: r.slots.obdCode } : {}) } : {}
        try { validateCall({ toolId: legacy.id, input: params }, test.role) } catch { policyDenied = !allowedTools(test.role).some(t => t.id === legacy.id) }
      }
      if (policyDenied) type = 'denied'
      const actualTools = policyDenied ? [] : toolIds
      const toolMatch = JSON.stringify(actualTools) === JSON.stringify(test.expected.tools)
        && (!test.expected.action || (r.action?.id === test.expected.action && r.action.confirmationRequired === true))
        && (!test.expected.articles || test.expected.articles.every(id => r.sources?.some(a => a.id === id)))
      if (!toolMatch) toolSelectionErrors++
      if (type === 'clarify' && ['answer','help','action_proposal'].includes(test.expected.type)) unneededClarifications++
      if (r.data != null) prematureFactPayloads++
      if (test.expected.type === 'denied') { denialCases++; if (type === 'denied') correctDenials++ }
      rows.push({ id: test.id, category: test.category, expectedType: test.expected.type, actualType: type, expectedTools: test.expected.tools,
        actualTools, languageContractPass: type === test.expected.type, planningPass: toolMatch && type === test.expected.type,
        fallback: !!r.planning?.fallback, actionConfirmation: r.action?.confirmationRequired ?? null })
    }
    const report = { at: new Date().toISOString(), corpus: '24 new development formulations, not independent/human validation',
      mode: live ? 'REAL_PROVIDER_SELECTION_ONLY' : rawRouter ? 'DETERMINISTIC_RAW_ROUTER_NOT_AUTHENTICATED_API' : 'DETERMINISTIC_LOCAL_ORCHESTRATION',
      modelAttemptsUpperBound: attempts, structuredPlansAcceptedByTransport: acceptedPlans,
      categories: {
        naturalLanguage: { evaluated: rows.length, passed: rows.filter(r => r.languageContractPass).length, limits: 'Expected response mode only, no human relevance/semantic explanation rating.' },
        planning: { evaluated: rows.length, passed: rows.filter(r => r.planningPass).length, toolSelectionErrors, invalidPlans, unneededClarifications, correctDenials, denialCases },
        businessAccuracy: { status: 'BLOCKED_NATIVE_DATABASE', evaluated: 0, factualErrorRate: null, prematureFactPayloads, limits: 'No database results in this runner; payload counter is structural, NOT semantic factual accuracy.' },
        toolExecution: { status: 'NOT_EXECUTED', nativeReads: 0, writes: 0, errorRate: null, limits: 'Selection/schema/RBAC checked only. Scripted reader tests are separate simulations, not native tool evidence.' },
      }, latency: { selectionOnly: stats(times), modelPlanAttempts: stats(modelTimes), coldApplication: null }, rows,
      limits: 'No SQL, authenticated HTTP, live issuer, browser or factual synthesis evaluated. No scripted model response in this corpus. Live mode requires external authorization; null transport may be auth/network/timeout/invalid JSON/circuit, not proof of successful model understanding. Cap bounds planner attempts, including circuit-short-circuited attempts. No response/query/key text logged.' }
    console.log(JSON.stringify(report, null, 2))
    if (rows.some(r => !r.planningPass) || invalidPlans || prematureFactPayloads) process.exitCode = 1
  })().catch(() => { console.error('Evaluation failed; confidential exception details omitted.'); process.exitCode = 2 })
}

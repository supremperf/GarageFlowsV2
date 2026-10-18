'use strict'
// Local development corpus; scripted planners are transport/contract tests, NOT live intelligence.
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { loader } = require('./evaluate-copilot.cjs')
const root = path.resolve(__dirname, '..')
const baseline = process.argv[2] || 'bd05cd521917cc059fc21780d1b562c020534942'
const old = loader(true, baseline)('src/lib/copilot/conversation.ts')
const load = loader(false)
const current = load('src/lib/copilot/conversation.ts')
const { TOOLS } = load('src/lib/copilot/tools.ts')
const cases = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/copilot/evaluation-cases.json'), 'utf8'))
const selectTools = r => r.plan?.calls.map(c => c.toolId) ?? (r.resolver && r.type === 'answer' ? [TOOLS.find(t => t.resolver === r.resolver)?.id ?? r.resolver] : [])
async function run(api) {
  const results = [], times = [], groups = {}
  let factPayloadViolations = 0, confirmationViolations = 0, invalidReturnedPlan = 0, unexpectedErrors = 0
  for (const test of cases) {
    let response, error, elapsed = []
    const provider = test.scriptedPlan ? { id: 'scripted-evaluation', name: 'Scripted, not live model', plan: async () => {
      if (test.scriptedPlan.failure) throw new Error('simulated network error')
      return test.scriptedPlan
    } } : null
    for (let i = 0; i < 15; i++) {
      const start = performance.now()
      try {
        const input = api.ConversationSchema.parse({ query: test.query, history: test.history.map(content => ({ role: 'user', content })) })
        response = await api.understand(input, test.role, provider)
      } catch (e) { error = e.message }
      elapsed.push(performance.now() - start)
    }
    times.push(...elapsed)
    if (error) unexpectedErrors++
    const tools = response ? selectTools(response) : []
    const articles = response?.sources?.map(s => s.id) ?? []
    const toolMatch = !test.expectedTools || JSON.stringify(test.expectedTools) === JSON.stringify(tools)
    const articleMatch = !test.expectedArticles || test.expectedArticles.every(id => articles.includes(id))
    const pass = !error && response?.type === test.expectedType && toolMatch && articleMatch
    if (response?.data != null) factPayloadViolations++ // understanding must not invent business results
    if (response?.action && response.action.confirmationRequired !== true) confirmationViolations++
    // Schema + role policy only for executable plans. Legacy resolver selection is separately gated by HTTP.
    if (response?.plan) {
      try { load('src/lib/copilot/execution.ts').validateExecutionPlan(response.plan.calls, test.role) } catch { invalidReturnedPlan++ }
    }
    const stratum = test.scriptedPlan ? 'scripted_planner' : 'local_only'
    const key = `${stratum}:${test.category}`
    groups[key] ??= { passed: 0, total: 0 }
    groups[key].total++; if (pass) groups[key].passed++
    results.push({ category: test.category, stratum, query: test.query, expectedType: test.expectedType,
      actualType: response?.type, expectedTools: test.expectedTools, tools, expectedArticles: test.expectedArticles, articles, pass, error })
  }
  times.sort((a, b) => a - b)
  return { passed: results.filter(r => r.pass).length, total: results.length, groups,
    localOnly: { passed: results.filter(r => r.stratum === 'local_only' && r.pass).length, total: results.filter(r => r.stratum === 'local_only').length },
    scriptedPlanner: { passed: results.filter(r => r.stratum === 'scripted_planner' && r.pass).length, total: results.filter(r => r.stratum === 'scripted_planner').length },
    samples: times.length, warmMedianMs: times[Math.floor(times.length * .5)], warmP95Ms: times[Math.floor(times.length * .95)],
    safetyCounters: { factPayloadViolations, confirmationViolations, invalidReturnedPlan, unexpectedErrors, evaluatedRequests: cases.length }, results }
}
;(async () => {
  const report = { baselineCommit: baseline, at: new Date().toISOString(), limitations:
    '68-case labelled DEVELOPMENT corpus, includes immediate scripted planner responses. Understanding/plan stage only; legacy backend clarification not executed. No DB, live model, browser, license, cold full startup, semantic hallucination rate or human relevance rating. 15 repetitions/case, compiler/import time excluded. No independent superiority claim.',
    before: await run(old), after: await run(current) }
  console.log(JSON.stringify(report, null, 2))
  const counters = report.after.safetyCounters
  if (Object.entries(counters).some(([key, value]) => key !== 'evaluatedRequests' && value > 0)) process.exitCode = 1
  // Honest quality gate: partial success remains a nonzero evaluation, never silently accepted.
  if (report.after.passed !== report.after.total) process.exitCode = 1
})().catch(e => { console.error(e.message); process.exitCode = 1 })

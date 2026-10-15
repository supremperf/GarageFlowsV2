'use strict'
/** Selection evaluation only. Gold annotations NEVER cross the provider boundary. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { z } = require('zod')
const root = path.resolve(__dirname, '..')
const MAX_OUTPUT_TOKENS = 512
const Approval = z.object({
  authorizationId: z.string().regex(/^[a-zA-Z0-9_-]{3,100}$/), model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  maxCalls: z.number().int().min(1).max(48), maxSpendEur: z.number().positive().finite(),
  maxInputTokensPerCall: z.number().int().min(1).max(200000), maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS),
  inputEurPerMillion: z.number().positive().finite(), outputEurPerMillion: z.number().positive().finite(),
  pricingReference: z.string().url().max(500), approvedAt: z.string().datetime({ offset: true }),
}).strict()
function verifyFreeze() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/COPILOT_PHASE4_VALIDATION_FREEZE.json')))
  const corpus = fs.readFileSync(path.join(root, 'src/lib/copilot/evaluation-phase4-validation.json'))
  const digest = crypto.createHash('sha256').update(corpus).digest('hex')
  if (digest !== manifest.sha256) throw new Error('Frozen validation corpus drift')
  const cases = JSON.parse(corpus)
  const development = ['evaluation-cases.json','evaluation-phase3.json'].flatMap(f => JSON.parse(fs.readFileSync(path.join(root,'src/lib/copilot',f))))
  if (cases.length !== manifest.count || new Set(cases.map(c => c.id)).size !== cases.length || cases.some(c => development.some(d => d.query === c.query))) throw new Error('Corpus overlap/count/ID failure')
  return { manifest, cases }
}
function reserveCost(approval, messages, ledger) {
  // No token-count API call: conservative UTF-8 text upper estimate + protocol allowance.
  const inputUpper = messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, 'utf8'), 4096)
  const maxEur = (inputUpper * approval.inputEurPerMillion + MAX_OUTPUT_TOKENS * approval.outputEurPerMillion) / 1e6
  if (ledger.attempts >= approval.maxCalls) return { allowed: false, reason: 'cap_blocked' }
  if (inputUpper > approval.maxInputTokensPerCall) return { allowed: false, reason: 'input_limit_blocked' }
  if (ledger.reservedMaxEur + maxEur > approval.maxSpendEur) return { allowed: false, reason: 'budget_blocked' }
  ledger.attempts++; ledger.reservedMaxEur += maxEur
  return { allowed: true, inputUpper, reservedMaxEur: maxEur }
}
function stats(values) {
  const sorted = [...values].sort((a,b) => a-b)
  return { samples: sorted.length, medianMs: sorted.length ? sorted[Math.floor(sorted.length*.5)] : null, p95Ms: sorted.length ? sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))] : null }
}
async function main(args) {
  if (args.some(a => !['--live','--approve-paid','--preflight','--verify-freeze'].includes(a) && !/^--max-calls=\d+$/.test(a) && !/^--approval=.+$/.test(a))) throw new Error('Unknown argument')
  const { manifest, cases } = verifyFreeze()
  const configuration = { explicitAnthropic: process.env.GARAGEFLOW_LLM === 'anthropic', keyPresent: !!process.env.ANTHROPIC_API_KEY?.trim(), modelPresent: !!process.env.GARAGEFLOW_LLM_MODEL }
  if (args.includes('--verify-freeze') || args.includes('--preflight')) {
    console.log(JSON.stringify({ freeze: { count: cases.length, sha256: manifest.sha256 }, configuration, networkAttempted: false, paidApproval: 'NOT_GRANTED_BY_PREFLIGHT_OR_FLAG', nativeFacts: 'NOT_EXECUTED' },null,2)); return
  }
  const live = args.includes('--live'); const cap = Number(args.find(a => a.startsWith('--max-calls='))?.split('=')[1])
  const approvalPath = args.find(a => a.startsWith('--approval='))?.slice('--approval='.length)
  if (live && (!args.includes('--approve-paid') || !configuration.explicitAnthropic || !configuration.keyPresent || !Number.isInteger(cap) || cap < 1 || cap > 48 || !approvalPath)) throw new Error('Live blocked: explicit external approval + one-use budget manifest + cap 1..48 + server config required; no call made')
  const { loader } = require('./evaluate-copilot.cjs'); const load = loader(false)
  const { understand } = load('src/lib/copilot/conversation.ts')
  const { TOOLS, validateCall, allowedTools } = load('src/lib/copilot/tools.ts')
  const { validateExecutionPlan } = load('src/lib/copilot/execution.ts')
  const provider = live ? load('src/lib/copilot-llm/provider.ts').resolveLlmProvider() : null
  const ledger = { attempts: 0, reservedMaxEur: 0 }; let approval = null; let controlled = null; let last = null
  if (live) {
    if (!provider?.interpret) throw new Error('No explicitly configured semantic provider')
    const absolute = path.resolve(approvalPath)
    approval = Approval.parse(JSON.parse(fs.readFileSync(absolute)))
    const actualModel = provider.status().model
    if (approval.model !== actualModel || cap > approval.maxCalls) throw new Error('Approval model/cap mismatch; no call made')
    approval.maxCalls = cap
    // Never silently replenish a run budget; even a failed run consumes this grant.
    const fd = fs.openSync(absolute + '.consumed', 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify({ authorizationId: approval.authorizationId, at: new Date().toISOString(), model: actualModel, maxCalls: cap, maxSpendEur: approval.maxSpendEur })) } finally { fs.closeSync(fd) }
    const { buildSemanticMessages } = load('src/lib/copilot-llm/prompts.ts')
    controlled = { id: provider.id, name: provider.name, interpret: async (request, options) => {
      const reservation = reserveCost(approval, buildSemanticMessages(request), ledger)
      if (!reservation.allowed) { last = { disposition: reservation.reason }; throw new Error('Approved evaluation budget exhausted') }
      const result = await provider.interpret(request, options)
      last = { disposition: 'attempted', ...reservation, technical: provider.lastAttempt() }
      return result
    } }
  }
  const rows = []; const times = []
  for (const test of cases) {
    last = null; const start = performance.now()
    const result = await understand({ query: test.query, history: test.history.map(content => ({ role: 'user', content })) },test.role,controlled)
    const ms = performance.now() - start; times.push(ms)
    let mode = result.sources?.length ? 'help' : result.type
    const tool = TOOLS.find(t => t.resolver === result.resolver && t.kind === 'read')
    let calls = result.plan?.calls ?? (tool && result.type === 'answer' ? [{ toolId: tool.id, input: tool.id === 'job_search' ? { reference: result.slots.text } : tool.id === 'vin_decode' ? { vin: result.slots.vin } : tool.id === 'diagnostic' ? { text: test.query, ...(result.slots.obdCode ? { obdCode: result.slots.obdCode } : {}) } : {} }] : [])
    let planValid = true; let policyDenied = false
    try { if (calls.length) validateExecutionPlan(calls,test.role) } catch {
      policyDenied = calls.some(c => !allowedTools(test.role).some(t => t.id === c.toolId))
      if (!policyDenied) planValid = false
    }
    if (policyDenied) { mode = 'denied'; calls = [] }
    // These predicates are selection/shape checks, NOT successful backend permissions/facts.
    const toolsPass = JSON.stringify(calls.map(c => c.toolId)) === JSON.stringify(test.expected.tools)
    const parametersPass = Object.entries(test.expected.parameters).every(([id, expected]) => Object.entries(expected).every(([key,val]) => calls.find(c => c.toolId === id)?.input[key] === val))
    const permissionsPass = calls.every(c => { try { validateCall(c,test.role); return true } catch { return false } })
    const confirmationPass = !test.expected.action || (result.action?.id === test.expected.action && result.action.confirmationRequired === true)
    const modePass = test.expected.modes.includes(mode)
    const articlesPass = test.expected.articles.every(id => result.sources?.some(a => a.id === id))
    const intentPass = result.processing ? result.processing.intent === test.expected.intent : null
    rows.push({ id: test.id, mode, intent: result.processing?.intent ?? null, intentPass, modePass, toolsPass, parametersPass, planValid, permissionsPass, confirmationPass, articlesPass,
      pass: modePass && toolsPass && parametersPass && planValid && permissionsPass && confirmationPass && articlesPass && intentPass !== false && result.data == null,
      actualTools: calls.map(c => c.toolId), prematureFacts: result.data != null,
      periodStatusValidation: result.processing?.planning === 'validated' ? 'BACKEND_FIXED_CONSTRAINTS_CHECKED; requested-semantic correctness NOT independently rated' : 'NOT_SEPARATELY_EVALUATED',
      finalResponse: 'NOT_EVALUATED_NATIVE_OR_HUMAN', latencyMs: ms, model: last ?? { disposition: live ? 'not_invoked_due_to_guard' : 'disabled' },
      estimatedUsageCostEur: last?.technical?.usage && approval ? (last.technical.usage.input_tokens * approval.inputEurPerMillion + last.technical.usage.output_tokens * approval.outputEurPerMillion) / 1e6 : null })
  }
  const report = { at: new Date().toISOString(), mode: live ? 'REAL_PROVIDER_SELECTION_ONLY' : 'LOCAL_SELECTION_ONLY', corpusSha256: manifest.sha256, frozenCount: cases.length,
    independence: manifest.independenceLimit, metrics: { selectedContracts: { passed: rows.filter(r=>r.pass).length,total: rows.length }, semanticIntent: { evaluated: rows.filter(r=>r.intentPass!==null).length,passed: rows.filter(r=>r.intentPass===true).length,unmeasured: rows.filter(r=>r.intentPass===null).length }, toolChoice: { passed: rows.filter(r=>r.toolsPass).length,total:rows.length }, parameters: { passed: rows.filter(r=>r.parametersPass).length,nonVacuousCases: cases.filter(c=>Object.keys(c.expected.parameters).length).length,total: rows.length }, permissions: { returnedCallViolations: rows.filter(r=>!r.permissionsPass).length, limits: 'No authenticated/native tenant isolation claim' }, facts: { status:'NOT_EXECUTED',evaluated:0,errorRate:null }, finalResponse: { status:'NOT_EVALUATED_NATIVE_OR_HUMAN',passed:null }, latency: { selectionOnly: stats(times),coldStartup:null }, technicalErrors: rows.filter(r=>r.model.technical && r.model.technical.outcome!=='valid_json_contract').map(r=>({id:r.id,outcome:r.model.technical.outcome,httpStatus:r.model.technical.httpStatus})) },
    budget: { ...ledger, estimatedUsageCostEur: ledger.attempts && rows.filter(r=>r.model.disposition==='attempted').every(r=>r.estimatedUsageCostEur!==null) ? rows.reduce((s,r)=>s+(r.estimatedUsageCostEur??0),0) : live ? null : 0, invoiceReconciled:false },rows,
    limits:'No SQL, write, authenticated HTTP, real issuer, browser or native final factual synthesis. No repeated calls/retries or generated gold IR. Valid JSON is not semantic success. Fallback/local results in live mode must not be counted as real-model comprehension. Pricing metadata is operator-approved, not current-price verification/invoice. Token upper estimate uses text bytes + 4096 protocol allowance.' }
  console.log(JSON.stringify(report,null,2))
  if (rows.some(r=>!r.pass)) process.exitCode = 1
}
module.exports = { verifyFreeze, reserveCost, Approval, stats }
if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('Evaluation blocked/failed; confidential exception details omitted. No automatic retry or budget replenishment.'); process.exitCode=2 })

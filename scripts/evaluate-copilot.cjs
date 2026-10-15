'use strict'
/** Offline hand-labelled routing evaluation; NOT a model intelligence/production benchmark.
 * Runs trusted repository TypeScript via its installed compiler, no remote code/service.
 * Baseline sources are read from a specified Git commit, never checked out or modified.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '..')
const baseline = process.argv[2] || '4f19f77891debc6009a1c241d2689f2a42bca0e8'
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Expected full baseline commit SHA')
function loader(old) {
  const cache = new Map()
  return function load(relative) {
    const file = path.resolve(root, relative)
    if (!file.startsWith(root + path.sep)) throw new Error('Source outside repository')
    if (cache.has(file)) return cache.get(file).exports
    const rel = path.relative(root, file).split(path.sep).join('/')
    const source = old ? execFileSync('git', ['show', `${baseline}:${rel}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    const localRequire = createRequire(file)
    const module = { exports: {} }
    cache.set(file, module)
    const requireSource = id => {
      if (id.startsWith('@/') || id.startsWith('.')) {
        const target = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(file), id)
        return load(path.relative(root, target.endsWith('.ts') ? target : `${target}.ts`))
      }
      return localRequire(id)
    }
    // Only trusted local/committed source; never accepts text, URLs, tools or model outputs.
    new Function('require', 'module', 'exports', compiled)(requireSource, module, module.exports)
    return module.exports
  }
}
const before = loader(true)('src/lib/copilot/engine.ts').handleQuery
const after = loader(false)('src/lib/copilot/conversation.ts').understand
const cases = [
  ['Devis en attente', 'pending_quotes'], ['Quel est le CA du jour ?', 'today_revenue'], ['Quelle est ma marge ?', 'margin'],
  ['Véhicules en retard', 'late_vehicles'], ['Stock bas', 'low_stock'], ['Mécaniciens disponibles', 'available_mechanics'],
  ['Meilleurs clients', 'top_clients'], ['Quelles priorités ?', 'proactive'], ['Prévision du CA', 'forecast_revenue'],
  ['Voyant moteur', 'diagnostic'], ['Décode le VIN', 'vin_decode'], ['Crée un devis', 'create_quote'],
  ['Comment créer un devis ?', 'help'], ['Comment commander des pièces ?', 'help'], ['Où trouver le planning ?', 'help'],
  ['Explique la marge', 'help'], ['Aide pour les clients', 'help'], ['Comment utiliser le diagnostic ?', 'help'],
  ['Comment envoyer un rappel ?', 'help'], ['Comment scanner une photo de plaque ?', 'help'],
  ['Retrouve le dossier AB-123-CD', 'job_search'], ['Retrouve le dossier de Dupont', 'job_search'],
  ['Retrouve le dossier', 'clarify'], ['Commander des pièces', 'clarify', 'RECEPTIONIST'],
  ['Et son statut ?', 'job_search', 'OWNER', ['Retrouve le dossier AB-123-CD']],
  ['Je devine', 'unknown'], ['Meilleurs fournisseurs', 'unknown'],
]
const category = r => r.sources?.length ? 'help' : r.resolver === 'job_search' ? 'job_search' : ['clarify', 'unknown'].includes(r.type) ? r.type : r.intent
async function run(fn) {
  const results = [], times = []
  for (const [query, expected, role = 'OWNER', history = []] of cases) {
    let result
    // Same await/clock overhead on both variants; warm compiler/import time excluded.
    for (let i = 0; i < 25; i++) {
      const start = performance.now()
      result = await fn(query, role, history)
      times.push(performance.now() - start)
    }
    results.push({ query, expected, actual: category(result), pass: category(result) === expected })
  }
  times.sort((a, b) => a - b)
  return { passed: results.filter(r => r.pass).length, total: results.length, samples: times.length,
    medianMs: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)], results }
}
;(async () => {
  const report = { baselineCommit: baseline, candidateHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    date: new Date().toISOString(), limitations: 'Hand-picked local regression corpus, 25 repetitions/query, no DB/UI/cloud, warm routing only. Not an independent accuracy or LLM latency evaluation.',
    before: await run(query => before(query)), after: await run((query, role, history) => after({ query, history: history.map(content => ({ role: 'user', content })) }, role, null)) }
  console.log(JSON.stringify(report, null, 2))
  if (report.after.passed !== report.after.total) process.exitCode = 1
})().catch(error => { console.error(error.message); process.exitCode = 1 })

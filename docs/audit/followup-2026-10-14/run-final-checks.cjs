'use strict'
// Auditing commands only. No install, deployment, signing, DB mutation or secret
// configuration. Optional diagnostic Python dependencies live outside the repo.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const root = path.resolve(__dirname, '../../..'), evidence = path.join(__dirname, 'evidence')
const pinned = '/home/user/audit-followup/tools/node_modules/npm/bin/npm-cli.js'
const env = { ...process.env, PATH: `/home/user/audit-followup/tools/node_modules/.bin:/home/user/audit-followup/.venv/bin:${process.env.PATH}` }
const version = cp.spawnSync('npm', ['--version'], { env, encoding: 'utf8' })
if (version.status !== 0 || version.stdout.trim() !== '11.16.0') throw new Error('Pinned npm must also resolve from PATH for child scripts')
const checks = [
  ['lint', ['run','lint'], 'lint.log'], ['type-check', ['run','type-check'], 'type-check.log'],
  ['config', ['run','test:config'], 'config.log'], ['security', ['run','test:audit'], 'security.log'],
  ['release-safety', ['run','test:release-safety'], 'release-safety.log'],
  ['consistency', ['run','check:consistency'], 'consistency.log'],
  ['audit-strict', ['run','audit:strict'], 'audit-strict.log'],
  ['npm-audit', ['audit','--json'], 'npm-audit.json'], ['npm-ls', ['ls','--all'], 'npm-ls.log'],
  ['targeted', ['test','--','src/lib/__tests__/toolchain-node-version.test.ts','src/lib/__tests__/ui-lossless-compaction.test.ts','src/lib/__tests__/route-context.test.ts'], 'confirmation-targeted.log'],
]
const manifest = { date: '2026-10-14', versions: { node: process.version, npm: version.stdout.trim(), systemNpmObservedEarlier: '10.9.8', python: cp.spawnSync('/home/user/audit-followup/.venv/bin/python3',['--version'],{encoding:'utf8'}).stdout.trim() }, checks: [], priorCommands: [] }
for (const [name,args,output] of checks) {
  const started = new Date().toISOString(), result = cp.spawnSync(process.execPath,[pinned,...args],{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:10*1024*1024})
  fs.writeFileSync(path.join(evidence,output), result.stdout + result.stderr)
  fs.writeFileSync(path.join(evidence,`${name}.exit`), `${result.status}\n`)
  manifest.checks.push({name,command:`node ${pinned} ${args.join(' ')}`,cwd:root,started,finished:new Date().toISOString(),exitCode:result.status,error:result.error?.code || null,proof:`evidence/${output}`})
  console.log(`${name}: ${result.status}`)
}
for (const [name,command,cwd] of [
  ['normal-ci',`NODE_USE_SYSTEM_CA=1 node ${pinned} ci --foreground-scripts --no-fund`,'/home/user/audit-followup/clean-lifecycle'],
  ['normal-build',`NODE_USE_SYSTEM_CA=1 node ${pinned} run build`,root],
  ['normal-dist',`NODE_USE_SYSTEM_CA=1 node ${pinned} run dist`,root],
  ['vitest-latest',`PATH=<isolated-python>:$PATH NODE_USE_SYSTEM_CA=1 node ${pinned} test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=docs/audit/followup-2026-10-14/evidence/vitest-latest.json`,root],
  ['e2e','BASE_URL=http://127.0.0.1:4028 AUDIT_E2E_DATABASE_URL=file:/home/user/audit-followup/e2e-attempt.db E2E_EMAIL= E2E_PASSWORD= E2E_LICENSE= NODE_USE_SYSTEM_CA=1 node node_modules/@playwright/test/cli.js test --config docs/audit/followup-2026-10-14/playwright-attempt.config.ts --workers=1',root],
]) {
  const exit = path.join(evidence, `${name}.exit`)
  manifest.priorCommands.push({name,command,cwd,exitCode:fs.existsSync(exit)?Number(fs.readFileSync(exit,'utf8').trim()):null,proof:`evidence/${name}.log`,limitation:'Executed earlier, not re-executed by this indexing script; see snapshot/run qualifications in REPORT.md.'})
}
manifest.negativeChecks = [
  { command: 'GF_REQUIRE_ARTIFACT_TEST=1 npm test -- src/__tests__/integrity-diagnostics.test.ts', observedExitCode:1, expectedExitCode:1, proof:'evidence/artifact-required-negative.log', meaning:'Missing real artefact fails; NOT positive artefact proof' },
  { command: 'npm test -- src/lib/license/__tests__/license-keygen-e2e.test.ts (system Python without cryptography)', observedExitCode:1, expectedExitCode:1, proof:'evidence/keygen-missing-negative.log', meaning:'Missing keygen dependency fails; positive run uses actual installed PyPI wheels separately' },
]
fs.writeFileSync(path.join(__dirname,'commands.json'),JSON.stringify(manifest,null,2)+'\n')
if (manifest.checks.some(result=>result.exitCode!==0)) process.exitCode=1

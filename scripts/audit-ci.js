#!/usr/bin/env node
'use strict'
// Full installed/locked dependency tree: no severity exceptions or omit=dev.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function assess(report) {
  const counts = report?.metadata?.vulnerabilities
  if (report?.error || !counts || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      !['low', 'moderate', 'high', 'critical', 'total'].every(k => Number.isInteger(counts[k]) && counts[k] >= 0)) {
    return { ok: false, reason: 'Audit indisponible ou réponse incomplète : validation bloquée.' }
  }
  const total = counts.low + counts.moderate + counts.high + counts.critical + (counts.info || 0)
  if (total !== counts.total || Object.keys(report.vulnerabilities).length !== counts.total) {
    return { ok: false, reason: 'Comptages incohérents : validation bloquée.' }
  }
  return { ok: counts.total === 0, reason: `LOW=${counts.low} MODERATE=${counts.moderate} HIGH=${counts.high} CRITICAL=${counts.critical} TOTAL=${counts.total}` }
}
// Only fixed state, numeric counts and a strict error-code token are emitted.
// Never publish npm's raw error summary/detail/URLs or authentication material.
function failureSummary(run, report) {
  const counts = report?.metadata?.vulnerabilities
  return {
    npmExitCode: Number.isInteger(run.status) ? run.status : null,
    responseHasError: !!report?.error,
    errorCode: typeof report?.error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(report.error.code) ? report.error.code : null,
    counts: counts && ['low', 'moderate', 'high', 'critical', 'total'].every(k => Number.isInteger(counts[k]) && counts[k] >= 0)
      ? Object.fromEntries(['low', 'moderate', 'high', 'critical', 'total'].map(k => [k, counts[k]])) : null,
    verdict: assess(report).reason,
  }
}
function npmPath() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js']
  const found = candidates.find(p => p && /npm-cli\.js$/.test(p) && fs.existsSync(p))
  if (!found) throw new Error('npm introuvable : validation bloquée.')
  return found
}
function main() {
  const run = spawnSync(process.execPath, [npmPath(), 'audit', '--json', '--audit-level=low',
    '--include=dev', '--include=optional', '--include=peer'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  })
  if (run.error || run.signal) throw new Error('Audit non exécuté : validation bloquée.')
  let report
  try { report = JSON.parse(run.stdout) } catch { throw new Error('Audit illisible : validation bloquée.') }
  const result = assess(report)
  console.log(result.reason)
  if (!result.ok || run.status !== 0) {
    console.error('::error title=Npm dependency audit::' + JSON.stringify(failureSummary(run, report)))
    process.exitCode = 1
  }
}
module.exports = { assess, failureSummary, main }
if (require.main === module) {
  try { main() } catch (error) { console.error('::error title=Npm dependency audit::' + error.message); process.exitCode = 1 }
}

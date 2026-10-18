#!/usr/bin/env node
'use strict'
// Read-only GitHub REST snapshot. Never dismisses alerts or uses GraphQL's ambiguous zero.
const { spawnSync } = require('node:child_process')

function assessAlerts(alerts) {
  if (!Array.isArray(alerts)) throw new Error('INVALID_ALERT_RESPONSE')
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, total: 0 }
  const seen = new Set(), inventory = []
  for (const alert of alerts) {
    const severity = alert.security_advisory?.severity
    if (!Number.isSafeInteger(alert.number) || alert.number < 1 || seen.has(alert.number) ||
        alert.state !== 'open' || !['critical', 'high', 'moderate', 'low'].includes(severity) ||
        typeof alert.security_advisory?.ghsa_id !== 'string' ||
        typeof alert.dependency?.package?.name !== 'string' ||
        typeof alert.dependency?.manifest_path !== 'string') throw new Error('INVALID_ALERT_RESPONSE')
    seen.add(alert.number)
    counts[severity]++; counts.total++
    inventory.push({ number: alert.number, severity, ghsa: alert.security_advisory.ghsa_id,
      package: alert.dependency.package.name, ecosystem: alert.dependency.package.ecosystem,
      manifest: alert.dependency.manifest_path, scope: alert.dependency.scope })
  }
  return { counts, inventory }
}
function snapshot(run = spawnSync) {
  const repo = 'supremperf/GarageFlowsV2'
  const call = args => run('gh', ['api', ...args], { encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  const unavailable = result => ({ ok: false, status: 'ACCESS_OR_QUERY_UNAVAILABLE', repository: repo,
    count: null, httpStatus: /HTTP (\d{3})/.exec(result.stderr || '')?.[1] ?? null,
    missionComplete: false, message: 'No zero inferred. Restore GitHub security read permission or provide an authorized export. No credential or API error body printed.' })
  const meta = call([`repos/${repo}`, '--jq', '.default_branch'])
  if (meta.status !== 0 || meta.error || meta.signal || !meta.stdout?.trim()) return unavailable(meta)
  const branch = meta.stdout.trim()
  const before = call([`repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha'])
  if (before.status !== 0 || before.error || before.signal || !/^[a-f0-9]{40}$/.test(before.stdout?.trim())) return unavailable(before)
  const alerts = call(['--paginate', `repos/${repo}/dependabot/alerts?state=open&per_page=100`, '--jq', 'if type == "array" then .[] | @json else error("NON_ARRAY_ALERT_RESPONSE") end'])
  if (alerts.status !== 0 || alerts.error || alerts.signal) return unavailable(alerts)
  let report
  try { report = assessAlerts(alerts.stdout.split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s))) }
  catch { return { ok: false, status: 'INVALID_ALERT_RESPONSE', count: null, missionComplete: false } }
  const after = call([`repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha'])
  if (after.status !== 0 || after.error || after.signal || before.stdout.trim() !== after.stdout?.trim()) {
    return { ok: false, status: 'DEFAULT_HEAD_CHANGED_OR_UNAVAILABLE', count: null, missionComplete: false }
  }
  return { ok: report.counts.total === 0, status: report.counts.total ? 'OPEN_ALERTS' : 'NO_OPEN_ALERTS_OBSERVED',
    repository: repo, defaultBranch: branch, defaultHead: before.stdout.trim(), observedUtc: new Date().toISOString(),
    ...report, scanFreshnessVerified: false, missionComplete: false,
    warning: 'REST open-alert snapshot only. Scan completion/freshness, exact candidate integration, source audit and functional validation still require separate evidence.' }
}
module.exports = { assessAlerts, snapshot }
if (require.main === module) {
  const result = snapshot()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

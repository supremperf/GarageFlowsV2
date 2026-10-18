'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { assessAlerts, snapshot } = require('../scripts/check-github-security.cjs')
const alert = (number, severity) => ({ number, state: 'open', security_advisory: { severity, ghsa_id: 'GHSA-fixture' },
  dependency: { package: { name: 'fixture-package', ecosystem: 'npm' }, manifest_path: 'package-lock.json', scope: 'runtime' } })
const sha = 'a'.repeat(40), nextSha = 'b'.repeat(40)
function fake(responses) {
  const calls = []
  const run = (...args) => { calls.push(args); assert.ok(responses.length); return responses.shift() }
  return { run, calls }
}
const ok = stdout => ({ status: 0, stdout, stderr: '' })
test('counts every severity without an audit-level exclusion or suppression', () => {
  const r = assessAlerts(['critical', 'high', 'moderate', 'low'].map((s, i) => alert(i + 1, s)))
  assert.deepEqual(r.counts, { critical: 1, high: 1, moderate: 1, low: 1, total: 4 })
  assert.equal(r.inventory.length, 4)
})
test('rejects malformed/unknown/duplicate/closed input rather than silently counting zero', () => {
  for (const value of [null, {}, [alert(1, 'unknown')], [alert(1, 'critical'), alert(1, 'critical')], [{ ...alert(1, 'high'), state: 'dismissed' }]]) {
    assert.throws(() => assessAlerts(value), /INVALID_ALERT_RESPONSE/)
  }
})
test('REST403 cannot turn an empty/error stdout into zero or leak the error body', () => {
  const f = fake([ok('main'), ok(sha), { status: 1, stdout: '', stderr: 'sensitive-error-body (HTTP 403)' }])
  const r = snapshot(f.run)
  assert.equal(r.ok, false); assert.equal(r.count, null); assert.equal(r.httpStatus, '403')
  assert.ok(!JSON.stringify(r).includes('sensitive-error-body'))
  assert.equal(r.missionComplete, false)
})
test('REST inventory requests complete pagination and never falls back to GraphQL', () => {
  const f = fake([ok('main'), ok(sha), ok(JSON.stringify(alert(12, 'low')) + '\n' + JSON.stringify(alert(13, 'high'))), ok(sha)])
  const r = snapshot(f.run)
  assert.equal(r.counts.total, 2); assert.equal(r.ok, false)
  assert.ok(f.calls[2][1].includes('--paginate'))
  assert.match(f.calls[2][1].at(-1), /type == "array"/)
  assert.ok(f.calls.every(c => !c[1].includes('graphql') && c[2].shell === false))
})
test('valid empty REST snapshot is not a certificate of freshness or mission completion', () => {
  const f = fake([ok('main'), ok(sha), ok(''), ok(sha)])
  const r = snapshot(f.run)
  assert.equal(r.ok, true); assert.equal(r.status, 'NO_OPEN_ALERTS_OBSERVED')
  assert.equal(r.counts.total, 0); assert.equal(r.scanFreshnessVerified, false)
  assert.equal(r.missionComplete, false)
})
test('default branch movement during query blocks a zero conclusion', () => {
  const f = fake([ok('main'), ok(sha), ok(''), ok(nextSha)])
  assert.equal(snapshot(f.run).status, 'DEFAULT_HEAD_CHANGED_OR_UNAVAILABLE')
})
test('a truncated or malformed successful API output remains invalid, not zero', () => {
  const f = fake([ok('main'), ok(sha), ok('{not-json')])
  const r = snapshot(f.run)
  assert.equal(r.ok, false); assert.equal(r.status, 'INVALID_ALERT_RESPONSE'); assert.equal(r.count, null)
})

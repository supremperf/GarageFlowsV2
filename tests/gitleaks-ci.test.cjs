'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { run, locations } = require('../scripts/gitleaks-ci.cjs')
// Unit tests of reporting/exit propagation, NOT an official secret scan.
function exercise(status, report, extra = {}) {
  const output = []; let temporary
  const exit = run({ commit: 'unit-test-commit', emit: x => output.push(x), spawn(command, args, options) {
    assert.equal(command, 'gitleaks')
    assert.deepEqual(args.slice(0, 7), ['dir', '.', '--config', '.gitleaks.toml', '--redact', '--no-banner', '--report-format'])
    assert.equal(options.stdio[1], 'pipe')
    const dest = args[args.indexOf('--report-path') + 1]
    temporary = require('node:path').dirname(dest)
    assert.equal(fs.statSync(temporary).mode & 0o777, 0o700)
    if (report !== undefined) fs.writeFileSync(dest, typeof report === 'string' ? report : JSON.stringify(report))
    return { status, stdout: extra.sensitive, stderr: extra.sensitive, ...extra }
  } })
  assert.equal(fs.existsSync(temporary), false)
  return { exit, text: output.join('\n') }
}
const finding = { RuleID: 'unit-rule', File: 'test/sample.ts', StartLine: 4, EndLine: 5 }
test('empty successful report preserves scanner exit zero', () => assert.equal(exercise(0, []).exit, 0))
test('official nil-slice JSON null is empty, but exit one remains inconsistent', () => {
  assert.equal(exercise(0, 'null').exit, 0)
  assert.equal(exercise(1, 'null').exit, 2)
})
test('finding metadata preserves exit one and never prints secret/match/child output', () => {
  const sensitive = crypto.randomBytes(48).toString('hex')
  const result = exercise(1, [{ ...finding, Secret: sensitive, Match: sensitive }], { sensitive })
  assert.equal(result.exit, 1)
  assert.ok(!result.text.includes(sensitive))
  assert.match(result.text, /file=test\/sample.ts,line=4,endLine=5,title=Gitleaks unit-rule/)
  assert.match(result.text, /1 findings; scanner exit 1/)
  assert.match(result.text, /Gitleaks inventory: findings=1; scannerExit=1/)
})
test('workflow command characters are escaped in file/rule/commit metadata', () => {
  const row = { ...finding, File: 'a,b:c%\r\n::error::injected', RuleID: 'a,b\r\n::error::injected' }
  const result = exercise(1, [row])
  assert.ok(!result.text.includes('\n::error::injected'))
  assert.match(result.text, /a%2Cb%3Ac%25%0D%0A/)
})
for (const [name, status, report, extra] of [
  ['scanner failure', 2, [], {}], ['spawn failure', null, [], { error: new Error('withheld') }],
  ['killed scanner', null, [], { signal: 'SIGTERM' }], ['missing report', 0, undefined, {}],
  ['bad JSON', 0, '{', {}], ['non-array report', 0, {}, {}],
  ['success with finding', 0, [finding], {}], ['failure without finding', 1, [], {}],
  ['invalid location', 1, [{ ...finding, StartLine: 0 }], {}],
]) test(name + ' is fail-closed', () => assert.notEqual(exercise(status, report, extra).exit, 0))
test('only whitelisted fields survive report projection', () => {
  assert.deepEqual(Object.keys(locations([{ ...finding, Secret: 'not-a-real-credential', Match: 'omitted', Entropy: 9 }], 'sha')[0]),
    ['rule', 'path', 'startLine', 'endLine', 'commit', 'scope', 'status'])
})

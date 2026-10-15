'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
test('secret scanner retains default rules and never exempts whole critical auth/public-key sources', () => {
  // Policy regression only, NOT a substitute for running the official scanner.
  const source = fs.readFileSync('.gitleaks.toml', 'utf8')
  assert.match(source, /useDefault\s*=\s*true/)
  const block = source.match(/paths\s*=\s*\[([\s\S]*?)\n\]/)[1]
  const paths = [...block.matchAll(/'''([^']*)'''/g)].map(m => new RegExp(m[1]))
  for (const file of ['src/lib/auth-secret.ts', 'src/app/api/health/route.ts', 'src/lib/license/public-key.ts']) {
    assert.ok(!paths.some(pattern => pattern.test(file)), `critical source excluded: ${file}`)
  }
})

test('three public OAuth headers and one frozen prose fingerprint are individually hash-locked', () => {
  const crypto = require('node:crypto')
  const rows = fs.readFileSync('docs/audit/resumption-2026-10-14/investigation-2026-10-14/gitleaks-triage.jsonl', 'utf8')
    .trim().split('\n').map(x => JSON.parse(x)).filter(r => r.classification === 'PUBLIC_OAUTH_CLIENT_IDENTIFIER')
  assert.equal(rows.length, 3)
  const prose = JSON.parse(fs.readFileSync('docs/audit/resumption-2026-10-14/validation-f88f283-2026-10-14/gitleaks-triage.jsonl', 'utf8').trim())
  assert.equal(prose.classification, 'DOCUMENTATION_PROSE')
  assert.equal(prose.path, 'docs/audit/resumption-2026-10-14/closure-2026-10-14/REPORT.md')
  assert.equal(prose.rule, 'generic-api-key')
  assert.equal(prose.startLine, 96)
  assert.equal(prose.endLine, 96)
  const proseBytes = fs.readFileSync(prose.path)
  assert.equal(crypto.createHash('sha256').update(proseBytes).digest('hex'), prose.sourceSha256,
    'Frozen prose changed; exception requires re-triage')
  const line = proseBytes.toString().split('\n')[prose.startLine - 1]
  assert.ok(line.startsWith('Revue complète de authz.ts : can/permissionsOf'))
  assert.ok(line.includes('Object.hasOwn'))
  assert.ok(line.endsWith('[lint](evidence/lint-final.log).'))
  const expected = [...rows, prose].map(r => `${r.path}:${r.rule}:${r.startLine}`).sort()
  const actual = fs.readFileSync('.gitleaksignore', 'utf8').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#')).sort()
  assert.deepEqual(actual, expected)
  for (const r of rows) {
    assert.equal(r.rule, 'generic-api-key')
    assert.match(r.path, /^docs\/audit\/resumption-2026-10-14\/evidence\/gh-(code-scanning|protection|rulesets)\.log$/)
    const bytes = fs.readFileSync(r.path)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), r.sourceSha256,
      'Exception invalidated: immutable evidence changed; re-triage required')
    assert.match(bytes.toString().split('\n')[r.startLine - 1], /^X-Oauth-Client-Id: [A-Za-z0-9]{20}\r?$/)
  }
})

test('phase4 digest exception requires exact receipt path AND exact hash-locked source line; no secret-shaped substitution', () => {
  const crypto = require('node:crypto')
  const triage = JSON.parse(fs.readFileSync('docs/audit/copilot-phase4/gitleaks-code-digest-triage.json', 'utf8'))
  const config = fs.readFileSync('.gitleaks.toml', 'utf8')
  const block = config.slice(config.indexOf('# Phase4: ten verified'))
  assert.match(block, /\[\[rules\]\]\s+id = "generic-api-key"/)
  assert.match(block, /condition = "AND"/)
  assert.match(block, /regexTarget = "line"/)
  const pathText = block.match(/paths = \[\s*'''([^']+)'''\s*\]/)[1]
  assert.equal(pathText, triage.receiptScope)
  const allowedPath = new RegExp(pathText)
  for (const p of ['docs/audit/copilot-phase4/F01.json','docs/audit/copilot-phase4/F32.json']) assert.ok(allowedPath.test(p))
  for (const p of ['src/lib/auth-secret.ts','docs/audit/copilot-phase4/F33.json','docs/other.json','docs/audit/copilot-phase4/nested/F16.json']) assert.ok(!allowedPath.test(p))
  const regexBlock = block.slice(block.indexOf('  regexes = ['))
  const patterns = [...regexBlock.matchAll(/'''([^']+)'''/g)].map(m => new RegExp(m[1]))
  assert.equal(patterns.length, 10); assert.equal(triage.sourcePairs.length, 10)
  for (const row of triage.sourcePairs) {
    assert.equal(row.classification,'VERIFIED_SOURCE_SHA256_NOT_CREDENTIAL')
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(row.sourcePath)).digest('hex'), row.sourceSha256,
      'Source digest changed: exception requires re-triage, not a broader pattern')
    const line = '    '+JSON.stringify(row.sourcePath)+': '+JSON.stringify(row.sourceSha256)+','
    assert.equal(patterns.filter(p => p.test(line)).length,1)
    assert.ok(!patterns.some(p => p.test(line.replace(row.sourceSha256,'0'.repeat(64)))))
    assert.ok(!patterns.some(p => p.test(line.replace(row.sourceSha256,'synthetic_credential_must_still_be_detected'))))
    assert.ok(!patterns.some(p => p.test(line.replace(row.sourcePath,'src/lib/auth-secret.ts'))))
  }
})

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

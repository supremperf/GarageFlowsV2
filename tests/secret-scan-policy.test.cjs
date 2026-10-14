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

test('only three hash-locked public OAuth header fingerprints are excepted', () => {
  const crypto = require('node:crypto')
  const rows = fs.readFileSync('docs/audit/resumption-2026-10-14/investigation-2026-10-14/gitleaks-triage.jsonl', 'utf8')
    .trim().split('\n').map(x => JSON.parse(x)).filter(r => r.classification === 'PUBLIC_OAUTH_CLIENT_IDENTIFIER')
  assert.equal(rows.length, 3)
  const expected = rows.map(r => `${r.path}:${r.rule}:${r.startLine}`).sort()
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

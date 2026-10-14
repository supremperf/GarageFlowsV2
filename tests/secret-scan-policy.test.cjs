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

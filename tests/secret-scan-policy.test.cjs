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
  const phase5 = JSON.parse(fs.readFileSync('docs/audit/copilot-phase5/gitleaks-triage.json', 'utf8')).map(r => r.fingerprint)
  assert.deepEqual(actual, [...expected, ...phase5].sort())
  for (const r of rows) {
    assert.equal(r.rule, 'generic-api-key')
    assert.match(r.path, /^docs\/audit\/resumption-2026-10-14\/evidence\/gh-(code-scanning|protection|rulesets)\.log$/)
    const bytes = fs.readFileSync(r.path)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), r.sourceSha256,
      'Exception invalidated: immutable evidence changed; re-triage required')
    assert.match(bytes.toString().split('\n')[r.startLine - 1], /^X-Oauth-Client-Id: [A-Za-z0-9]{20}\r?$/)
  }
})

test('every phase5 suppression is an exact hash-locked location; prior twenty individually retained', () => {
  const { verifyFinding } = require('../scripts/lib/copilot-receipt-triage.cjs')
  const rows = JSON.parse(fs.readFileSync('docs/audit/copilot-phase5/gitleaks-triage.json','utf8'))
  const summary = JSON.parse(fs.readFileSync('docs/audit/copilot-phase5/gitleaks-triage-summary.json','utf8'))
  assert.equal(rows.length,summary.triagedTotal)
  assert.equal(new Set(rows.map(r => r.fingerprint)).size,rows.length)
  assert.equal(summary.officialFindings,669)
  assert.equal(summary.previousExactSuppressionLocations,290)
  assert.equal(rows.filter(r => r.classification==='VERIFIED_PUBLIC_FILE_SHA256').length,957)
  assert.equal(rows.filter(r => r.classification==='DOCUMENTATION_ASSERTION_LITERAL').length,2)
  for (const row of rows) assert.equal(verifyFinding(row),true)
  for (const [file,lines] of [['F16',[328,259,258,220,155,147,144,143,134,130]],['F22',[491,490,438,420,369,368,350,349,344,336]]]) {
    for (const line of lines) assert.ok(rows.some(r => r.path===`docs/audit/copilot-phase4/${file}.json` && r.startLine===line && verifyFinding(r)))
  }
  // Remove the provisional phase4 regex extension; no whole-file/all-SHA exemption.
  const config=fs.readFileSync('.gitleaks.toml','utf8')
  assert.ok(!config.includes('[[rules]]'))
  assert.ok(!config.includes('Ten cryptographically'))
})

test('changed receipt/source/line/prose or unknown classification invalidates suppression', () => {
  const { verifyFinding } = require('../scripts/lib/copilot-receipt-triage.cjs')
  const rows=JSON.parse(fs.readFileSync('docs/audit/copilot-phase5/gitleaks-triage.json','utf8'))
  for (const row of [rows.find(r=>r.classification==='VERIFIED_PUBLIC_FILE_SHA256'),rows.find(r=>r.classification==='DOCUMENTATION_ASSERTION_LITERAL')]) {
    assert.throws(()=>verifyFinding(row,process.cwd(),Buffer.from('synthetic changed bytes')))
    assert.throws(()=>verifyFinding({...row,startLine:row.startLine+1}))
    assert.throws(()=>verifyFinding({...row,classification:'UNREVIEWED'}))
    assert.throws(()=>verifyFinding({...row,path:'../../outside'}))
  }
  const digest=rows.find(r=>r.classification==='VERIFIED_PUBLIC_FILE_SHA256')
  assert.throws(()=>verifyFinding({...digest,sourceSha256:'0'.repeat(64)}))
})

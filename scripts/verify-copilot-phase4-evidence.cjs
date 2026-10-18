'use strict'
/** Hash/receipt integrity ONLY, never functional/native/model certification. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname,'..')
const { verifyFreeze } = require('./evaluate-copilot-phase4.cjs')
function digest(file) {
 const full = path.resolve(root,file)
 if (!full.startsWith(root+path.sep)) throw new Error('Evidence path outside repository')
 return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
}
const index = JSON.parse(fs.readFileSync(path.join(root,'docs/COPILOT_PHASE4_EVIDENCE.json')))
verifyFreeze()
for (const entry of [...index.receipts,...index.normalizedLogs,...index.semanticReview]) if (digest(entry.path)!==entry.sha256) throw new Error('Evidence/source drift: '+entry.path)
const historical = JSON.parse(fs.readFileSync(path.join(root,'docs/COPILOT_PHASE3_EVIDENCE.json')))
for (const entry of index.preservedHistoricalDocuments) if (digest(entry.path)!==entry.sha256) throw new Error('Historical report drift: '+entry.path)
if (index.phase3SourceReviewCountAtIntake!==historical.semanticReview.length) throw new Error('Intake count drift')
console.log(JSON.stringify({status:'METADATA_ONLY_PASS',receipts:index.receipts.length,normalizedLogs:index.normalizedLogs.length,reviewedFiles:index.semanticReview.length,preservedHistoricalDocuments:index.preservedHistoricalDocuments.length,limits:'No runtime/SQL/auth/paid-model/production validation; index self-hash closed by containing Git commit, final verification receipt intentionally outside this index.'},null,2))

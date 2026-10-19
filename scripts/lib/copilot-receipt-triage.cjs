'use strict'
// Policy tests only: NEVER a replacement for running the unchanged official scanner.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function resolve(root, file) {
 const p = path.resolve(root,file)
 if (!p.startsWith(path.resolve(root)+path.sep)) throw new Error('Invalid triage path')
 return p
}
function verifyFinding(row,root=process.cwd(),bytesOverride) {
 if (row.rule!=='generic-api-key' || row.startLine!==row.endLine || !Number.isSafeInteger(row.startLine) || row.startLine<1) throw new Error('Invalid finding')
 const bytes = bytesOverride ?? fs.readFileSync(resolve(root,row.path))
 const line=bytes.toString().split('\n')[row.startLine-1]
 const fp=`${row.path}:${row.rule}:${row.startLine}`
 if (row.fingerprint!==fp) throw new Error('Fingerprint drift')
 if (row.classification==='VERIFIED_PUBLIC_FILE_SHA256') {
  if (!/^docs\/audit\/copilot-phase4\/F\d{2}\.json$/.test(row.path) || sha(bytes)!==row.receiptSha256) throw new Error('Receipt drift')
  const obj=JSON.parse(bytes);const entry=JSON.parse('{'+line.trim().replace(/,$/,'')+'}')
  if (Object.keys(entry).length!==1 || entry[row.sourcePath]!==row.sourceSha256 || obj.sourceHashes[row.sourcePath]!==row.sourceSha256) throw new Error('Digest entry drift')
  const source=fs.readFileSync(resolve(root,row.sourceSnapshot || row.sourcePath))
  if (sha(source)!==row.sourceSha256) throw new Error('Source drift; re-triage required')
 } else if (row.classification==='DOCUMENTATION_ASSERTION_LITERAL') {
  if (sha(bytes)!==row.fileSha256 || sha(line)!==row.lineSha256) throw new Error('Public assertion drift')
  const arg=line.match(/\.startsWith\('([^']+)'\)/)
  const prose=fs.readFileSync(resolve(root,row.frozenProsePath))
  if (!arg || sha(prose)!==row.frozenProseSha256 || !prose.toString().split('\n')[row.frozenProseLine-1].startsWith(arg[1])) throw new Error('Prose provenance drift')
 } else throw new Error('Unclassified finding cannot be suppressed')
 return true
}
module.exports={verifyFinding,sha}

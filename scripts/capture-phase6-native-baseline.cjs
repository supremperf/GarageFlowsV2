'use strict'
// A historical NEGATIVE diagnostic, never the candidate's native success gate.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict'),zlib=require('node:zlib')
const baseline='0d64899ed81ab32ab99fa32fbd6cde0c55d5ec63'
function encodeProof(proof){
 const encoded=zlib.deflateSync(Buffer.from(JSON.stringify(proof))).toString('base64'),size=1800,count=Math.ceil(encoded.length/size);assert.ok(count>0&&count<=8)
 return Array.from({length:count},(_,n)=>({page:n+1,pages:count,complete:true,encoding:'deflate-base64',payload:encoded.slice(n*size,(n+1)*size)}))
}
module.exports={encodeProof}
function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-phase6-baseline-'));fs.chmodSync(temp,0o700)
 const fixture=path.resolve('src/integration/phase6-historical-cout-achat.test.ts');let created=false
 try{
  // Fetch only the known public baseline tree if shallow checkout lacks it.
  const present=cp.spawnSync('git',['cat-file','-e',baseline+'^{commit}'])
  if(present.status!==0)cp.execFileSync('git',['fetch','--no-tags','--depth=1','origin',baseline],{stdio:'pipe'})
  const source=cp.execFileSync('git',['show',baseline+':src/integration/copilot-cout-achat.test.ts'])
  fs.writeFileSync(fixture,source,{flag:'wx',mode:0o600});created=true
  const cli=path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs'),reportFile=path.join(temp,'results.json')
  const env={...process.env,GARAGEFLOW_LLM:'off'};delete env.ANTHROPIC_API_KEY;delete env.GARAGEFLOW_LLM_MODEL
  const run=cp.spawnSync(process.execPath,[cli,'run',fixture,'--reporter=json',`--outputFile=${reportFile}`],{env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
  fs.writeFileSync(path.join(temp,'stdout.txt'),run.stdout??'',{mode:0o600});fs.writeFileSync(path.join(temp,'stderr.txt'),run.stderr??'',{mode:0o600})
  const report=JSON.parse(fs.readFileSync(reportFile));const tests=report.testResults.flatMap(f=>f.assertionResults)
  assert.equal(run.status,1);assert.deepEqual(tests.map(t=>t.status),['failed','failed','passed','passed','passed'])
  // These two known fixture-only failures contain no auth tokens or DB payload:
  // undefined .message and non-iterable .data from the correct forbidden reply.
  const proof={scope:'HISTORICAL_NEGATIVE_DIAGNOSTIC_NOT_CANDIDATE_PASS',baseline,childExitCode:run.status,caseStatuses:tests.map(t=>t.status),failures:tests.filter(t=>t.status==='failed').map(t=>({name:t.fullName,fullTrace:t.failureMessages})),stdout:run.stdout,stderr:run.stderr}
  // GitHub annotation rendering transforms ANSI escapes in JSON strings. Encode
  // AFTER constructing the complete diagnostic so no trace/output bytes are lost.
  for(const page of encodeProof(proof))console.log(`::notice title=Phase6 native baseline page ${page.page}/${page.pages}::`+JSON.stringify(page))
 }finally{if(created)fs.unlinkSync(fixture);fs.rmSync(temp,{recursive:true,force:true})}
}
if(require.main===module){try{main()}catch{console.error('Historical negative diagnostic incomplete; no baseline result asserted and raw details withheld');process.exitCode=2}}

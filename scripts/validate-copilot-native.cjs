'use strict'
// Genuine Vitest/native Prisma run; only safe counts/statuses leave the private report.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process')
const suites=['copilot-conversation','copilot','copilot-ecusson-verifie','copilot-financial-authz-v15','copilot-cout-achat','copilot-portee-et-porte-financiere'].map(n=>`src/integration/${n}.test.ts`)
function summarize(report,exitCode) {
 const files=(report.testResults??[]).map(r=>({path:path.relative(process.cwd(),r.name).split(path.sep).join('/'),passed:(r.assertionResults??[]).filter(t=>t.status==='passed').length,failed:(r.assertionResults??[]).filter(t=>t.status==='failed').length,caseStatuses:(r.assertionResults??[]).map(t=>['passed','failed','pending','skipped','todo','disabled'].includes(t.status)?t.status:'unknown'),unexecuted:(r.assertionResults??[]).filter(t=>t.status!=='passed'&&t.status!=='failed').length}))
 const executed=files.reduce((s,f)=>s+f.passed+f.failed,0)
 const complete=files.length===6&&new Set(files.map(f=>f.path)).size===6&&files.every(f=>suites.includes(f.path))
 const passed=exitCode===0&&report.success===true&&complete&&executed===54&&files.every(f=>f.failed===0&&f.unexecuted===0)&&report.numTotalTests===54
 return {schema:1,scope:'SIX_NATIVE_PRISMA_SUITES_54_ASSERTIONS',exitCode,passed,executed,expected:54,files,paidCalls:0,limits:'Native fixture tests only; not production issuer/tenant/auth HTTP/model campaign. Setup-blocked/skipped assertions are NOT passes.'}
}
function main() {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'garageflows-native-'));fs.chmodSync(temp,0o700)
 try {
  const env={...process.env,GARAGEFLOW_LLM:''};delete env.ANTHROPIC_API_KEY;delete env.GARAGEFLOW_LLM_MODEL
  const cli=path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs')
  const reportFile=path.join(temp,'results.json')
  const run=cp.spawnSync(process.execPath,[cli,'run',...suites,'--reporter=json',`--outputFile=${reportFile}`],{env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
  let report;try{report=JSON.parse(fs.readFileSync(reportFile,'utf8'))}catch{report={}}
  const summary=summarize(report,run.status??2)
  console.log('::notice title=Copilot native summary::'+JSON.stringify(summary))
  process.exitCode=summary.passed?0:(run.status||2)
 } finally {fs.rmSync(temp,{recursive:true,force:true})}
}
module.exports={summarize,suites}
if(require.main===module)main()

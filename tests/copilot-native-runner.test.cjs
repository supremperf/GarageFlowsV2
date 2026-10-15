'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {summarize,suites}=require('../scripts/validate-copilot-native.cjs')
const fixture=()=>({success:true,numTotalTests:54,testResults:suites.map(p=>({name:path.resolve(p),assertionResults:Array.from({length:9},()=>({status:'passed'}))}))})
test('native summary accepts only six actual suites and all 54 passed assertions',()=>assert.equal(summarize(fixture(),0).passed,true))
test('setup failure skips, missing/duplicate suites, killed Vitest or fewer assertions never pass',()=>{
 const pending=fixture();pending.testResults[0].assertionResults[0].status='pending'
 const failed=fixture();failed.testResults[0].assertionResults[0].status='failed'
 const missing=fixture();missing.testResults.pop()
 const dup=fixture();dup.testResults[0]=dup.testResults[1]
 for(const r of [pending,failed,missing,dup,{}, {...fixture(),numTotalTests:53},{...fixture(),success:false}])assert.equal(summarize(r,0).passed,false)
 for(const code of [1,2,null])assert.equal(summarize(fixture(),code).passed,false)
})
test('summary never projects failure messages or raw fields',()=>{
 const r=fixture();r.testResults[0].failureMessage='SYNTHETIC_PRIVATE_DETAILS';r.testResults[0].assertionResults[0].failureMessages=['SYNTHETIC_PRIVATE_DETAILS'];assert.ok(!JSON.stringify(summarize(r,1)).includes('SYNTHETIC_PRIVATE_DETAILS'))
})

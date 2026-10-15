'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reserveCost, Approval, stats } = require('../scripts/evaluate-copilot-phase4.cjs')
const approval = { version:2, scope:'COPILOT_SELECTION_FROZEN48', corpusSha256:'a'.repeat(64), runnerSha256:'b'.repeat(64), expiresAt:'2026-10-15T13:00:00+02:00', authorizationId:'SYNTHETIC_UNIT_ONLY', model:'test-model', maxCalls:2, maxSpendEur:1, maxInputTokensPerCall:10000, maxOutputTokens:512, inputEurPerMillion:1, outputEurPerMillion:2, pricingReference:'https://example.test/unit-only', approvedAt:'2026-10-15T12:00:00+02:00' }
test('budget manifest refuses unbounded/missing/extra/increased output fields', () => {
 assert.equal(Approval.safeParse(approval).success,true)
 for (const x of [{...approval,maxCalls:49},{...approval,maxSpendEur:0},{...approval,maxOutputTokens:1024},{...approval,key:'not-accepted'},{...approval,inputEurPerMillion:undefined}]) assert.equal(Approval.safeParse(x).success,false)
})
test('reserves the worst cost before dispatch, no automatic replenishment', () => {
 const ledger={attempts:0,reservedMaxEur:0};const messages=[{content:'synthetic unit input'}]
 assert.equal(reserveCost(approval,messages,ledger).allowed,true)
 assert.equal(reserveCost(approval,messages,ledger).allowed,true)
 assert.equal(reserveCost(approval,messages,ledger).reason,'cap_blocked')
 assert.equal(ledger.attempts,2);assert.ok(ledger.reservedMaxEur>0)
})
test('cost or input limit blocks before consuming any call', () => {
 for (const a of [{...approval,maxSpendEur:.000001},{...approval,maxInputTokensPerCall:10}]) {
  const ledger={attempts:0,reservedMaxEur:0};assert.equal(reserveCost(a,[{content:'message'}],ledger).allowed,false);assert.equal(ledger.attempts,0);assert.equal(ledger.reservedMaxEur,0)
 }
})
test('empty latency samples stay null, not synthetic zeros', () => assert.deepEqual(stats([]),{samples:0,medianMs:null,p95Ms:null}))

test('live gate refuses before any provider/network setup even with CLI approval flag', async () => {
 const {main}=require('../scripts/evaluate-copilot-phase4.cjs')
 await assert.rejects(()=>main(['--live','--approve-paid','--max-calls=1','--approval=nonexistent']),/monetary ceiling/)
})
test('model JSON, local fallback, no-call guards and accepted interpretation remain separate',()=>{
 const {classifyStratum,partitionMetrics}=require('../scripts/evaluate-copilot-phase4.cjs')
 const attempt={disposition:'attempted',technical:{outcome:'valid_json_contract'}}
 assert.equal(classifyStratum(true,{planning:{source:'local'}},attempt),'LOCAL_FALLBACK_AFTER_ATTEMPT')
 assert.equal(classifyStratum(true,{planning:{source:'model'}},attempt),'LOCAL_FALLBACK_AFTER_ATTEMPT')
 assert.equal(classifyStratum(true,{planning:{source:'model'},processing:{interpretation:'validated_contract'}},attempt),'REAL_MODEL_ACCEPTED')
 assert.equal(classifyStratum(true,{}, {disposition:'budget_blocked'}),'NO_CALL_GUARD')
 assert.equal(classifyStratum(false,{},attempt),'LOCAL_ONLY')
 const m=partitionMetrics([{stratum:'LOCAL_ONLY',pass:true},{stratum:'LOCAL_FALLBACK_AFTER_ATTEMPT',pass:true},{stratum:'REAL_MODEL_ACCEPTED',pass:false}])
 assert.equal(m.REAL_MODEL_ACCEPTED.selectedContractsPassed,0)
 assert.equal(m.LOCAL_FALLBACK_AFTER_ATTEMPT.selectedContractsPassed,1)
})

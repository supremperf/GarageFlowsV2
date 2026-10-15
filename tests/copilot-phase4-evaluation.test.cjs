'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reserveCost, Approval, stats } = require('../scripts/evaluate-copilot-phase4.cjs')
const approval = { authorizationId:'SYNTHETIC_UNIT_ONLY', model:'test-model', maxCalls:2, maxSpendEur:1, maxInputTokensPerCall:10000, maxOutputTokens:512, inputEurPerMillion:1, outputEurPerMillion:2, pricingReference:'https://example.test/unit-only', approvedAt:'2026-10-15T12:00:00+02:00' }
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

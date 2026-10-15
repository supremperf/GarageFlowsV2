'use strict'
const {test}=require('node:test'),a=require('node:assert/strict'),{project,pages}=require('../scripts/report-codeql-locations.cjs')
test('SARIF projection retains rules and all source/sink locations, never code snippets/messages',()=>{
 const l={physicalLocation:{artifactLocation:{uri:'src/fixture.ts'},region:{startLine:12,snippet:{text:'PRIVATE_SYNTHETIC_VALUE'}}}}
 const rows=project({runs:[{results:[{ruleId:'js/fixture',message:{text:'PRIVATE_SYNTHETIC_VALUE'},locations:[l],codeFlows:[{threadFlows:[{locations:[{location:l},{location:l}]}]}]}]}]})
 a.equal(rows[0].flows[0].length,2);a.equal(rows[0].ruleId,'js/fixture');a.ok(!JSON.stringify(rows).includes('PRIVATE_SYNTHETIC_VALUE'))
 a.throws(()=>project({runs:[{results:[{locations:[{physicalLocation:{artifactLocation:{uri:'https://example.test/private'}}}]}]}]}))
})
test('bounded pages preserve all results and reject overflow rather than fake completeness',()=>{
 const rows=Array.from({length:17},(_,index)=>({index,ruleId:'js/fixture',locations:[]}));a.deepEqual(pages(rows).flatMap(p=>p.rows),rows)
 a.throws(()=>pages([{blob:'x'.repeat(2300)}]));a.throws(()=>pages(Array.from({length:20},()=>({blob:'x'.repeat(1800)}))))
})

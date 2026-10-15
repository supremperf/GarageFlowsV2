'use strict'
const {test}=require('node:test'),a=require('node:assert/strict'),{project,pages}=require('../scripts/report-codeql-locations.cjs')
test('SARIF projection retains rules and all source/sink locations, never code snippets/messages',()=>{
 const l={physicalLocation:{artifactLocation:{uri:'src/fixture.ts'},region:{startLine:12,snippet:{text:'PRIVATE_SYNTHETIC_VALUE'}}}}
 const rows=project({runs:[{results:[{ruleId:'js/fixture',message:{text:'PRIVATE_SYNTHETIC_VALUE'},locations:[l],codeFlows:[{threadFlows:[{locations:[{location:l},{location:l}]}]}]}]}]})
 a.equal(rows[0].flows[0].length,2);a.equal(rows[0].ruleId,'js/fixture');a.ok(!JSON.stringify(rows).includes('PRIVATE_SYNTHETIC_VALUE'))
 a.throws(()=>project({runs:[{results:[{locations:[{physicalLocation:{artifactLocation:{uri:'https://example.test/private'}}}]}]}]}))
})
test('bounded pages preserve all results and reject overflow rather than fake completeness',()=>{
 const rows=Array.from({length:17},(_,index)=>({index,ruleId:'js/fixture',locations:[],flows:[{metadata:'x'.repeat(4000)}]}))
 const encoded=pages(rows);const decoded=JSON.parse(require('node:zlib').inflateSync(Buffer.from(encoded.map(p=>p.payload).join(''),'base64')))
 a.deepEqual(decoded,rows);a.ok(encoded.every(p=>JSON.stringify(p).length<3000))
 a.throws(()=>pages([{metadata:require('node:crypto').randomBytes(50000).toString('hex')}]))
})

test('artifact indexes resolve to physical source paths without leaking artifact bodies',()=>{
 const rows=project({runs:[{artifacts:[{location:{uri:'src/fixture.ts'},contents:{text:'PRIVATE_SYNTHETIC_VALUE'}}],results:[{ruleId:'js/fixture',locations:[{physicalLocation:{artifactLocation:{index:0},region:{startLine:3}}}]}]}]})
 a.equal(rows[0].locations[0].path,'src/fixture.ts');a.ok(!JSON.stringify(rows).includes('PRIVATE_SYNTHETIC_VALUE'))
})

test('CodeQL query pack extension metadata supplies rule severity without messages',()=>{
 const rows=project({runs:[{tool:{driver:{rules:[]},extensions:[{rules:[{id:'js/fixture',properties:{'security-severity':'7.5'},defaultConfiguration:{level:'warning'},fullDescription:{text:'PRIVATE_SYNTHETIC_VALUE'}}]}]},results:[{ruleId:'js/fixture',locations:[]}]}]})
 a.deepEqual(rows[0].ruleMetadata,{securitySeverity:'7.5',level:'warning'});a.ok(!JSON.stringify(rows).includes('PRIVATE_SYNTHETIC_VALUE'))
 a.throws(()=>project({}));a.throws(()=>project({runs:[{results:[{locations:[{}]}]}]}))
})

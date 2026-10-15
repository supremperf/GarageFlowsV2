'use strict'
const {test}=require('node:test'),a=require('node:assert/strict'),core=require('../scripts/config-core.cjs'),next=require('@next/env')
test('real Next dotenv consumer preserves dollar/backslash/quote attack strings and cannot create extra keys',()=>{
 const inputs=['$HOME','\\$HOME','\\\\$HOME','${HOME}','$(synthetic-not-executed)','x"$HOME',"x'\\$HOME",'x\\n$HOME','x # comment','x`literal','\\$','${MISSING:-fallback}']
 for(const value of inputs){
  const contents=core.serializeEnv({PHASE6_CONTEXT_FIXTURE:value},['PHASE6_CONTEXT_FIXTURE'],'desktop')
  const parsed=next.processEnv([{path:'phase6-synthetic.env',contents,env:{}}],undefined,undefined,true)[1]
  a.equal(parsed.PHASE6_CONTEXT_FIXTURE,value)
  a.deepEqual(Object.keys(parsed),['PHASE6_CONTEXT_FIXTURE'])
  a.equal(core.parseEnv(contents).PHASE6_CONTEXT_FIXTURE,value)
  delete process.env.PHASE6_CONTEXT_FIXTURE
 }
 for(const value of ['x\nINJECTED=1','x\rINJECTED=1','x\0INJECTED=1','all\'"`quotes\\'])a.throws(()=>core.serializeEnv({PHASE6_CONTEXT_FIXTURE:value},['PHASE6_CONTEXT_FIXTURE'],'desktop'))
})

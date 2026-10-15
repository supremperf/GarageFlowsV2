'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {canonical,verifyGrant,claimAuthorization}=require('../scripts/lib/copilot-evaluation-approval.cjs')
const approval={authorizationId:'SYNTHETIC_UNIT_ONLY',model:'test-model',scope:'COPILOT_SELECTION_FROZEN48',corpusSha256:'a'.repeat(64),runnerSha256:'b'.repeat(64),approvedAt:'2026-10-15T12:00:00Z',expiresAt:'2026-10-15T13:00:00Z'}
const expected={...approval,now:Date.parse('2026-10-15T12:30:00Z')}
test('operator signature binds scope, model, corpus, runner and bounded time; not a billing enforcement proof',()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519')
 const envelope={approval,signatureBase64:crypto.sign(null,canonical(approval),privateKey).toString('base64')}
 assert.equal(verifyGrant(envelope,publicKey,expected),approval)
 assert.throws(()=>verifyGrant({...envelope,approval:{...approval,model:'changed'}},publicKey,expected))
 for(const e of [{...expected,now:Date.parse('2026-10-15T14:00:00Z')},{...expected,now:Date.parse('2026-10-15T11:00:00Z')},{...expected,model:'other'},{...expected,runnerSha256:'c'.repeat(64)},{...expected,corpusSha256:'c'.repeat(64)}])assert.throws(()=>verifyGrant(envelope,publicKey,e))
})
test('copying or renaming a grant cannot reset its exclusive authorization-ID claim',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-grant-unit-'))
 try{fs.chmodSync(temp,0o700);claimAuthorization(approval,temp);assert.throws(()=>claimAuthorization(JSON.parse(JSON.stringify(approval)),temp),{code:'EEXIST'});assert.equal(fs.statSync(path.join(temp,approval.authorizationId+'.json')).mode&0o777,0o600)}finally{fs.rmSync(temp,{recursive:true,force:true})}
})
test('unsafe state permissions and traversal IDs fail closed',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-grant-unit-'))
 try{fs.chmodSync(temp,0o755);assert.throws(()=>claimAuthorization(approval,temp));assert.throws(()=>claimAuthorization({...approval,authorizationId:'../escape'},temp))}finally{fs.rmSync(temp,{recursive:true,force:true})}
})

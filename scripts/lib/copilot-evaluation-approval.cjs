'use strict'
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const canonical=approval=>Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(approval).sort(([a],[b])=>a.localeCompare(b)))))
function verifyGrant(envelope,publicKey,expected) {
 const a=envelope.approval
 if(!a || !crypto.verify(null,canonical(a),publicKey,Buffer.from(envelope.signatureBase64??'','base64')))throw new Error('Invalid operator signature')
 const now=expected.now??Date.now(),start=Date.parse(a.approvedAt),end=Date.parse(a.expiresAt)
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start||end-start>86400000)throw new Error('Expired/future/overlong grant')
 if(a.scope!=='COPILOT_SELECTION_FROZEN48' || a.corpusSha256!==expected.corpusSha256 || a.runnerSha256!==expected.runnerSha256 || a.model!==expected.model)throw new Error('Grant scope mismatch')
 return a
}
function claimAuthorization(approval,stateRoot=path.join(os.userInfo().homedir,'.garageflows-evaluation-authorization-state')) {
 if(!/^[a-zA-Z0-9_-]{3,100}$/.test(approval.authorizationId))throw new Error('Invalid authorization ID')
 fs.mkdirSync(stateRoot,{recursive:true,mode:0o700})
 const stat=fs.lstatSync(stateRoot)
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw new Error('Unsafe authorization state directory')
 // Fixed private host state keyed by SIGNED ID, never approval-file path.
 const fd=fs.openSync(path.join(stateRoot,approval.authorizationId+'.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600)
 try{fs.writeFileSync(fd,JSON.stringify({authorizationId:approval.authorizationId,at:new Date().toISOString(),grantSha256:crypto.createHash('sha256').update(canonical(approval)).digest('hex')}));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
module.exports={canonical,verifyGrant,claimAuthorization}

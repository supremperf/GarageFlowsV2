'use strict'
// New official API-asset diagnostic, not a retry of the earlier curl redirect.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const release=JSON.parse(fs.readFileSync(path.join(__dirname,'evidence/gh-gitleaks-release.log'),'utf8'))
const dir='/home/user/audit-resumption/.cache/gitleaks';fs.mkdirSync(dir,{recursive:true});const rows=[]
for(const name of ['gitleaks_8.24.3_checksums.txt','gitleaks_8.24.3_linux_x64.tar.gz']){
 const asset=release.assets.find(a=>a.name===name);if(!asset)throw new Error('Official asset absent')
 const args=['api','-H','Accept: application/octet-stream',`repos/gitleaks/gitleaks/releases/assets/${asset.id}`]
 const r=cp.spawnSync('gh',args,{timeout:60000,maxBuffer:30*1024*1024});const bytes=r.stdout||Buffer.alloc(0)
 const isJson=bytes.subarray(0,1).toString()==='{';const destination=path.join(dir,name)
 fs.writeFileSync(destination,bytes,{flag:'wx'});rows.push({name,assetId:asset.id,url:asset.url,argv:['gh',...args],exitCode:r.status,error:r.error?.code||null,bytes:bytes.length,jsonInsteadOfAsset:isJson,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),diagnostic:(r.stderr||Buffer.alloc(0)).toString().replace(/https:\/\/release-assets\.githubusercontent\.com\/[^\s"\\]+/g,url=>url.split('?')[0]+'?<redacted-signed-query>').slice(0,2000)})
}
fs.writeFileSync(path.join(__dirname,'evidence/gitleaks-api-assets.json'),JSON.stringify(rows,null,2),{flag:'wx'});console.log(JSON.stringify(rows,null,2))
if(rows.some(r=>r.exitCode!==0||r.jsonInsteadOfAsset||!r.bytes))process.exitCode=1
else{
 const sums=fs.readFileSync(path.join(dir,rows[0].name),'utf8'),line=sums.split('\n').find(l=>l.endsWith(rows[1].name)),expected=line?.split(/\s+/)[0]
 if(!/^[a-f0-9]{64}$/.test(expected||'')||expected!==rows[1].sha256)throw new Error('Official checksum mismatch; no binary executed')
 console.log('OFFICIAL CHECKSUM VERIFIED — extraction/scan remain separate actions')
}

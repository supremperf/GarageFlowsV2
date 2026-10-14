'use strict'
const fs=require('node:fs'),path=require('node:path'),dns=require('node:dns').promises,https=require('node:https'),cp=require('node:child_process'),crypto=require('node:crypto'),os=require('node:os')
const B=__dirname,root=path.resolve(B,'../../../..'),url='https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.sha256'
async function main(){
 const out={at:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),node:process.version,npm:cp.execFileSync('npm',['--version']).toString().trim(),platform:os.platform(),arch:os.arch(),release:os.release(),openssl:process.versions.openssl,requestedUrl:url,versions:{},security:{rejectUnauthorized:true,NODE_TLS_REJECT_UNAUTHORIZED:process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'?'UNSAFE inherited setting':'not disabled',NODE_EXTRA_CA_CERTS_configured:!!process.env.NODE_EXTRA_CA_CERTS,NODE_USE_SYSTEM_CA:process.env.NODE_USE_SYSTEM_CA||null},proxy:{}}
 for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy'])out.proxy[k]={configured:!!process.env[k],valueWithheld:true}
 for(const p of ['prisma','@prisma/client','@prisma/engines'])out.versions[p]=require(path.join(root,'node_modules',p,'package.json')).version
 for(const config of ['strict-ssl','proxy','https-proxy','cafile']){const p=cp.spawnSync('npm',['config','get',config],{encoding:'utf8'});out['npm_'+config]={exitCode:p.status,...(config==='strict-ssl'?{value:p.stdout.trim()}:{configured:!['null','undefined',''].includes(p.stdout.trim()),valueWithheld:true})}}
 try{out.dns={addresses:await dns.lookup('binaries.prisma.sh',{all:true})}}catch(e){out.dns={code:e.code}}
 await new Promise(resolve=>{
  const req=https.get(url,{rejectUnauthorized:true,timeout:15000},res=>{out.http={statusCode:res.statusCode};const chunks=[];res.on('data',b=>{if(chunks.reduce((s,c)=>s+c.length,0)<8192)chunks.push(b)});res.on('end',()=>{const data=Buffer.concat(chunks);out.http.responseBytes=data.length;out.http.validChecksumFormat=res.statusCode===200&&/^[a-f0-9]{64}(?:\s|$)/i.test(data.toString());out.http.responseSha256=crypto.createHash('sha256').update(data).digest('hex');resolve()})})
  req.on('socket',s=>s.once('secureConnect',()=>{const c=s.getPeerCertificate();out.tls={authorized:s.authorized,authorizationError:s.authorizationError||null,protocol:s.getProtocol(),subject:c.subject,issuer:c.issuer,validFrom:c.valid_from,validTo:c.valid_to,fingerprint256:c.fingerprint256}}))
  req.on('timeout',()=>req.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));req.on('error',e=>{out.networkError={code:e.code,message:e.code==='ECONNRESET'?'Socket disconnected before secure TLS connection was established':e.code||e.name};resolve()})
 })
 out.integrity={binaryDownloaded:false,binaryChecksumVerified:false,reason:'This diagnostic requests only the official SHA256; binary validation requires a successful official download and checksum comparison.'};out.limitation='No TLS bypass, CA replacement or alternate mirror used; no peer certificate is available if TLS never completes. Platform network policy permits only GitHub/npm/PyPI hosts, not binaries.prisma.sh.'
 fs.writeFileSync(path.join(B,'prisma-network.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(out,null,2))
}
main().catch(e=>{console.error(e.name);process.exitCode=1})

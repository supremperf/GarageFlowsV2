'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const root=path.resolve(__dirname,'../../../..'),out=path.join(__dirname,'evidence');fs.mkdirSync(out,{recursive:true})
const [id,...argv]=process.argv.slice(2)
if(!/^[a-z0-9-]+$/.test(id||'')||!argv.length)throw new Error('id and exact argv required')
const dest=path.join(out,id+'.log')
const started=new Date(),env={...process.env,PATH:'/home/user/audit-followup/tools/node_modules/.bin:/home/user/audit-followup/.venv/bin:'+process.env.PATH,NODE_USE_SYSTEM_CA:'1'}
const timeoutMs=Number(process.env.AUDIT_COMMAND_TIMEOUT_MS||240000)
if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw new Error('Invalid audit timeout')
const proofFd=fs.openSync(dest,'wx',0o600)
let r
try { r=cp.spawnSync(argv[0],argv.slice(1),{cwd:root,env,encoding:'utf8',timeout:timeoutMs,maxBuffer:20*1024*1024})
fs.writeFileSync(proofFd,(r.stdout||'')+(r.stderr||''))
} finally { fs.closeSync(proofFd) }
const row={id,startedAt:started.toISOString(),finishedAt:new Date().toISOString(),timezone:'Europe/Paris',startedLocal:new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'full',timeStyle:'long'}).format(started),cwd:root,argv,timeoutMs,toolVersionsFile:'../tool-versions.json',head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),workingTree:cp.execFileSync('git',['status','--porcelain'],{cwd:root}).toString(),environmentOverrides:{PATH:'pinned npm + isolated Python + inherited PATH',NODE_USE_SYSTEM_CA:'1'},node:process.version,exitCode:r.status,signal:r.signal,error:r.error?.code||null,proof:'evidence/'+id+'.log'}
fs.appendFileSync(path.join(__dirname,'commands.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row,null,2));process.exitCode=r.status??1

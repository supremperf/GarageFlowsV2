'use strict'
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto')
const B=__dirname,cache='/home/user/audit-resumption/.cache/validation-f88f283-parser-probe';fs.mkdirSync(cache,{recursive:true})
const variants={original:"async function f(importOriginal: <T>() => Promise<T>) { const reel = await importOriginal<typeof import('./fixture')>(); return {...reel} }\n",namespace:"import type * as OriginalModule from './fixture'\nasync function f(importOriginal: <T>() => Promise<T>) { const reel = await importOriginal<typeof OriginalModule>(); return {...reel} }\n",alias:"type OriginalModule = typeof import('./fixture')\nasync function f(importOriginal: <T>() => Promise<T>) { const reel = await importOriginal<OriginalModule>(); return {...reel} }\n"}
const rows=[]
for(const [name,text] of Object.entries(variants)){
 const input=path.join(cache,name+'.ts'),output=path.join(cache,name+'.json');fs.writeFileSync(input,text)
 const argv=['scan','--disable-version-check','--metrics=off','--strict','--lang','typescript','--pattern','importOriginal<$T>()','--json','--output',output,input]
 const r=cp.spawnSync('/home/user/audit-resumption/.venv/bin/semgrep',argv,{encoding:'utf8',env:{...process.env,SEMGREP_ENABLE_VERSION_CHECK:'0',SEMGREP_SEND_METRICS:'off'},timeout:60000});const x=JSON.parse(fs.readFileSync(output))
 rows.push({name,inputText:text,inputSha256:crypto.createHash('sha256').update(text).digest('hex'),argv,exitCode:r.status,results:x.results.length,errors:x.errors.map(e=>({code:e.code,type:typeof e.type==='string'?e.type:e.type?.[0]})),limits:'Diagnostic grammar probe only; no claim of product scan coverage or runtime validation.'})
}
fs.writeFileSync(path.join(B,'parser-probe.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(rows,null,2))

'use strict'
// Limited confidentiality preflight before the explicitly authorized push.
// NOT Gitleaks, NOT proof that all secrets have been detected. Never print values.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path')
const root=path.resolve(__dirname,'../../..'),files=[...new Set(cp.execFileSync('git',['ls-files','-c','-o','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean))]
const rules=[['COMPLETE_PRIVATE_PEM',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['GITHUB_TOKEN',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],['SIGNED_DOWNLOAD_QUERY',/[?&](?:sig|signature|jwt|X-Amz-Signature)=[A-Za-z0-9_%+./=-]{20,}/gi]]
let scanned=0;const candidates=[]
for(const file of files){const p=path.join(root,file);if(!fs.existsSync(p)||!fs.lstatSync(p).isFile())continue;const b=fs.readFileSync(p);if(b.includes(0))continue;scanned++;const s=b.toString();for(const [rule,regex] of rules){regex.lastIndex=0;for(const m of s.matchAll(regex))candidates.push({path:file,line:s.slice(0,m.index).split('\n').length,rule,status:'EN ATTENTE DE REVUE'})}}
const result={at:new Date().toISOString(),timezone:'Europe/Paris',textFiles:scanned,candidates,limitations:['Three high-confidence pattern families only; binary files not inspected. Not a replacement for official full Gitleaks or artifact inspection.','Fixture hits require explicit per-case review, no blanket source exclusion.']}
const output=process.argv[2]||'publication-preflight.json';if(!/^[a-z0-9-]+\.json$/.test(output))throw new Error('Expected a local JSON evidence basename');fs.writeFileSync(path.join(__dirname,output),JSON.stringify(result,null,2),{flag:process.argv[2]?'wx':'w'});console.log(JSON.stringify({textFiles:scanned,candidateCount:candidates.length,candidates},null,2));if(candidates.length)process.exitCode=1

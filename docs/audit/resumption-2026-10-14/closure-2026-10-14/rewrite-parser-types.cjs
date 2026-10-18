'use strict'
// Reversible, type-preserving source refactor: no suppression or assertion change.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript')
const B=__dirname,root=path.resolve(B,'../../../..'),prior=JSON.parse(fs.readFileSync(path.join(B,'../investigation-2026-10-14/sast-summary-final.json'))),rows=[]
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const emit=(text,file)=>ts.transpileModule(text,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,sourceMap:false,removeComments:true}}).outputText
const planned=[]
for(const e of prior.errors){
 const file=path.join(root,e.path),before=fs.readFileSync(file,'utf8');if(hash(before)!==e.sourceSha256)throw Error('Source changed: '+e.path)
 const types=new Map();let occurrences=0
 const afterBody=before.replace(/importOriginal<typeof import\((['"])([^'"]+)\1\)>\(\)/g,(_s,q,mod)=>{occurrences++;if(!types.has(mod))types.set(mod,{name:'OriginalModule'+(types.size+1),query:`typeof import(${q}${mod}${q})`});return `importOriginal<${types.get(mod).name}>()`})
 if(!occurrences)throw Error('No matching grammar construct: '+e.path)
 for(const {name} of types.values())if(new RegExp('\\b'+name+'\\b').test(before))throw Error('Alias collision')
 const idx=afterBody.search(/^import\s/m);if(idx<0)throw Error('No import insertion point')
 const declarations=[...types.values()].map(t=>`type ${t.name} = ${t.query}`).join('\n')+'\n\n'
 const after=afterBody.slice(0,idx)+declarations+afterBody.slice(idx)
 const beforeJs=emit(before,e.path),afterJs=emit(after,e.path)
 if(beforeJs!==afterJs)throw Error('Runtime emit differs: '+e.path)
 planned.push({file,after});rows.push({path:e.path,beforeSha256:hash(before),afterSha256:hash(after),replacements:occurrences,aliases:[...types.entries()].map(([module,v])=>({module,...v})),emittedJsIdentical:true,emittedJsSha256:hash(afterJs),status:'PARTIELLEMENT VALIDÉ',limits:'Type-only refactor; TS 5.9.3 ES2022/ESNext emitted JavaScript byte-identical with removeComments=true and sourceMap=false. All source comments preserved. Full-project typecheck and real scanner rerun required; not persistence/browser validation.'})
}
for(const p of planned)fs.writeFileSync(p.file,p.after)
fs.writeFileSync(path.join(B,'parser-refactor.json'),JSON.stringify({at:new Date().toISOString(),typescript:ts.version,rows},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:rows.length,replacements:rows.reduce((s,r)=>s+r.replacements,0),allEmittedJsIdentical:true},null,2))

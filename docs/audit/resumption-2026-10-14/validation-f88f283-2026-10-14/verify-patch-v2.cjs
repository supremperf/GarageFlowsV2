'use strict'
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path'),ts=require('typescript')
const root=process.cwd(),B=__dirname,C=path.join(B,'../closure-2026-10-14'),hash=x=>crypto.createHash('sha256').update(x).digest('hex')
const emit=(text,file)=>ts.transpileModule(text,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,sourceMap:false,removeComments:true}}).outputText
const before=p=>cp.execFileSync('git',['show','4989b53:'+p],{encoding:'utf8'})
const rows=JSON.parse(fs.readFileSync(path.join(C,'parser-refactor.json'))).rows.map(r=>{
 const a=before(r.path),b=fs.readFileSync(r.path,'utf8');const out={path:r.path,beforeSha256:hash(a),currentSha256:hash(b),emittedJsIdentical:emit(a,r.path)===emit(b,r.path),expectLinesIdentical:JSON.stringify(a.split('\n').filter(l=>l.includes('expect(')))===JSON.stringify(b.split('\n').filter(l=>l.includes('expect(')))}
 if(!out.emittedJsIdentical||!out.expectLinesIdentical||out.currentSha256!==r.afterSha256)throw Error('Parser change mismatch '+r.path);return out
})
const p='src/integration/invoice-authz.test.ts',a=before(p),b=fs.readFileSync(p,'utf8'),expect=s=>s.split('\n').filter(l=>l.includes('expect('))
const fixture={path:p,beforeSha256:hash(a),currentSha256:hash(b),expectCount:expect(b).length,expectLinesIdentical:JSON.stringify(expect(a))===JSON.stringify(expect(b)),ids:[...b.matchAll(/id: '(authz-aud-[^']+)'/g)].map(m=>m[1])}
if(fixture.expectCount!==16||!fixture.expectLinesIdentical||fixture.ids.length!==5||fixture.ids.some(id=>id.includes('400000')))throw Error('Fixture assertion mismatch')
const authBefore=before('src/lib/authz.ts'),authAfter=fs.readFileSync('src/lib/authz.ts','utf8')
const unchangedExceptGuards=authAfter.replace('if (!role || !Object.hasOwn(MATRIX, role))','if (!role)').replace('if (!role || !Object.hasOwn(PERM_LIST, role))','if (!role)')===authBefore
if(!unchangedExceptGuards)throw Error('Unexpected authz change')
const output={at:new Date().toISOString(),typescript:ts.version,head:cp.execFileSync('git',['rev-parse','HEAD']).toString().trim(),parser:rows,fixture,authz:{unchangedExceptGuards,behaviour:'Six Object.prototype names rejected by both public helpers: false / empty defensive list; no grants changed.'},limits:'JS equivalence is not SQLite runtime validation; historical collision analysis preserved in closure. No sources rewritten.'}
fs.writeFileSync(path.join(B,'patch-verification-v2.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(output,null,2))

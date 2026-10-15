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
test('actual extracted Electron dotenv loader consumes config output without altering dollars, backticks or pre-existing environment (real FS unit)',t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),vm=require('node:vm'),{decodeDotenvValue}=require('../electron/dotenv-value')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-phase6-desktop-env-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'electron'))
 const values=['$HOME','\\$HOME','\\\\$HOME','x"$HOME',"both'\"quotes\\n$cash",'$(synthetic-not-executed)','has`backtick']
 const env=Object.fromEntries(values.map((v,i)=>['PHASE6_DESKTOP_FIXTURE_'+i,v]));env.PHASE6_EXISTING='file-value'
 const file=path.join(dir,'.env'),contents=core.serializeEnv(env,Object.keys(env),'desktop');fs.writeFileSync(file,contents)
 const source=fs.readFileSync('electron/main.js','utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const loader=ast.statements.find(n=>ts.isExpressionStatement(n)&&n.getText(ast).includes('function loadDotEnv()'));a.ok(loader)
 const processFixture={env:{PHASE6_EXISTING:'original-process-value'}}
 vm.runInNewContext(loader.getText(ast),{fs,path,__dirname:path.join(dir,'electron'),process:processFixture,decodeDotenvValue})
 for(let i=0;i<values.length;i++)a.equal(processFixture.env['PHASE6_DESKTOP_FIXTURE_'+i],values[i])
 a.equal(processFixture.env.PHASE6_EXISTING,'original-process-value');a.equal(fs.readFileSync(file,'utf8'),contents)
})

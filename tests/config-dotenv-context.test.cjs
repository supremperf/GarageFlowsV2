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
 vm.runInNewContext(loader.getText(ast),{fs,path,__dirname:path.join(dir,'electron'),process:processFixture,decodeDotenvValue,app:{isPackaged:false}})
 for(let i=0;i<values.length;i++)a.equal(processFixture.env['PHASE6_DESKTOP_FIXTURE_'+i],values[i])
 a.equal(processFixture.env.PHASE6_EXISTING,'original-process-value');a.equal(fs.readFileSync(file,'utf8'),contents)
})

test('packaged Electron never reads or creates a project dotenv file',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
 const source=fs.readFileSync('electron/main.js','utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const loader=ast.statements.find(n=>ts.isExpressionStatement(n)&&n.getText(ast).includes('function loadDotEnv()'))
 const forbidden=new Proxy({}, {get(){throw Error('Packaged mode touched the project filesystem')}})
 const processFixture={env:{PHASE6_EXISTING:'preserved'}}
 vm.runInNewContext(loader.getText(ast),{fs:forbidden,path:forbidden,app:{isPackaged:true},process:processFixture})
 a.deepEqual(processFixture.env,{PHASE6_EXISTING:'preserved'})
})

test('dotenv serializer rejects injected identifiers before emitting any assignment',()=>{
 for(const name of ['A\nINJECTED','A=INJECTED','A\rB','A\0B','#COMMENT',' A','A B','A$B','']) {
  a.throws(()=>core.serializeEnv({[name]:'fixture-value'},[name],'desktop'),/Nom de variable environnement invalide/)
 }
 for(const name of ['GOOD_NAME','_PRIVATE','SystemRoot','custom.setting-0','1PREFIX'])a.match(core.serializeEnv({[name]:'fixture-value'},[name],'desktop'),new RegExp('^'+name+'=','m'))
})
test('bounded differential dotenv matrix preserves representable quote/backslash/dollar contexts',()=>{
 const alphabet=['x','\\','$',"'",'"','`','#',' ']
 let executed=0,rejected=0
 for(let i=0;i<alphabet.length;i++)for(let j=0;j<alphabet.length;j++)for(let k=0;k<alphabet.length;k++) {
  const value='prefix'+alphabet[i]+alphabet[j]+alphabet[k]+'suffix'
  let contents
  try{contents=core.serializeEnv({PHASE6_CONTEXT_FIXTURE:value},['PHASE6_CONTEXT_FIXTURE'],'desktop')}
  catch(error){a.match(error.message,/non représentable sans ambiguïté/);a.ok((value.includes('"')||value.includes('\\'))&&value.includes("'")&&value.includes('`'));rejected++;continue}
  const parsed=next.processEnv([{path:'synthetic-matrix.env',contents,env:{}}],undefined,undefined,true)[1]
  a.equal(parsed.PHASE6_CONTEXT_FIXTURE,value);a.deepEqual(Object.keys(parsed),['PHASE6_CONTEXT_FIXTURE'])
  a.equal(core.parseEnv(contents).PHASE6_CONTEXT_FIXTURE,value)
  delete process.env.PHASE6_CONTEXT_FIXTURE;executed++
 }
 a.equal(executed+rejected,512);a.ok(executed>400)
})

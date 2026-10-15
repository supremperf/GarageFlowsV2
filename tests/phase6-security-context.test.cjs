'use strict'
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),zlib=require('node:zlib')
const {encodeProof}=require('../scripts/capture-phase6-native-baseline.cjs')
test('historical trace transport roundtrips full ANSI, unicode, percent signs and failure stacks',()=>{
 const proof={failures:['TypeError\n at synthetic:5:2','TypeError\n at synthetic:9:2'],stdout:'résumé 100%\r\n',stderr:'\u001b[33mwarning\u001b[0m\n'}
 const pages=encodeProof(proof)
 a.deepEqual(JSON.parse(zlib.inflateSync(Buffer.from(pages.map(p=>p.payload).join(''),'base64'))),proof)
 a.ok(pages.every(p=>p.complete&&p.encoding==='deflate-base64'))
 a.throws(()=>encodeProof({synthetic:require('node:crypto').randomBytes(30000).toString('hex')}))
})
test('backup-code modulo has exactly eight preimages per symbol, not biased: real source alphabet has 32 unique symbols',()=>{
 const source=fs.readFileSync('src/lib/portal/backup-codes.ts','utf8'),ast=ts.createSourceFile('backup-codes.ts',source,ts.ScriptTarget.Latest,true)
 let alphabet
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='ALPHABET'&&n.initializer&&ts.isStringLiteral(n.initializer))alphabet=n.initializer.text;ts.forEachChild(n,visit)}visit(ast)
 a.equal(alphabet.length,32);a.equal(new Set(alphabet).size,32)
 // Guard the production expression to which this exact finite proof applies.
 a.ok(source.includes('crypto.randomBytes(GROUP * GROUPS)'))
 a.ok(source.includes('ALPHABET[bytes[i] % ALPHABET.length]'))
 const counts=Array(32).fill(0);for(let byte=0;byte<256;byte++)counts[byte%alphabet.length]++
 a.deepEqual(counts,Array(32).fill(8))
})
test('actual extracted Electron flush function: revoked consent performs no queue read and no send (unit, not packaged Electron)',async()=>{
 const source=fs.readFileSync('electron/main.js','utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='flushCrashQueue');a.ok(fn)
 let reads=0,sends=0
 const flush=vm.runInNewContext('('+fn.getText(ast)+')',{crashConsent:()=>false,readCrashQueue:()=>{reads++;return[{consent:true}]},httpPost:async()=>{sends++;return{ok:true}}})
 await flush();a.equal(reads,0);a.equal(sends,0)
})

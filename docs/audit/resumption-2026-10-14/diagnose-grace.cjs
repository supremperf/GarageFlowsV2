'use strict'
// Deliberate failing audit counterexample, not a passing product regression.
// Simulated OLD age + actual lossless SQLite copy + real production pure policy.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process')
const {evaluerGraceHorsLigne:evaluate}=require('../../../electron/grace-hors-ligne')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-grace-owned-')),src=path.join(dir,'old.db'),dest=path.join(dir,'copy.db')
try{
 cp.execFileSync('python3',['-c','import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("CREATE TABLE marker(value INTEGER)");c.execute("INSERT INTO marker VALUES(17)");c.commit();c.close()',src])
 // Read through real SQLite before copying; no database or key outside this owned fixture.
 const query='import sqlite3,sys\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok";print(c.execute("SELECT value FROM marker").fetchone()[0]);c.close()'
 const oldValue=cp.execFileSync('python3',['-c',query,src],{encoding:'utf8'}).trim()
 fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL)
 const newValue=cp.execFileSync('python3',['-c',query,dest],{encoding:'utf8'}).trim()
 const now=Date.now(),h=3600000,base={enregistrement:null,maintenant:now,horlogeIncoherente:false,seuilAvertissementMs:48*h,seuilVerrouMs:72*h}
 const before=evaluate({...base,naissanceBase:now-200*h}),after=evaluate({...base,naissanceBase:fs.statSync(dest).birthtimeMs})
 const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
 const proof={at:new Date().toISOString(),timezone:'Europe/Paris',status:'ÉCHOUÉ',issueId:'FUP-20261014-025',sourcePath:'electron/grace-hors-ligne.js',sourceSha256:digest(path.resolve(__dirname,'../../../electron/grace-hors-ligne.js')),oldCreationTimeWasSimulated:true,actualOldFileBirthtimeMs:fs.statSync(src).birthtimeMs,actualCopiedFileBirthtimeMs:fs.statSync(dest).birthtimeMs,originalSha256:digest(src),copySha256:digest(dest),oldSqliteMarker:oldValue,copiedSqliteMarker:newValue,before,after,limitations:['The 200-hour OLD age is an arithmetic fixture, not a 200-hour physical run or a backdated inode.','The copy is an actual complete SQLite file with integrity_check and identical bytes/data. It disproves the comment that recreation necessarily loses all data.','Policy called with no signed last-online record and coherent clock; Electron startup, official authority, and revocation flow are not executed.','No product policy changed: approved durable licensing anchor and restoration/new-install behavior require design validation.']}
 fs.writeFileSync(path.join(__dirname,'evidence/grace-anchor-counterexample.json'),JSON.stringify(proof,null,2),{flag:'wx'});console.log(JSON.stringify(proof,null,2))
 if(proof.originalSha256===proof.copySha256&&oldValue===newValue&&before.decision==='verrou'&&after.decision==='ok')process.exitCode=1
 else throw Error('Counterexample assumptions did not hold; review before classifying')
}finally{fs.rmSync(dir,{recursive:true,force:true})}

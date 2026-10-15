'use strict'
// Read-only SARIF projection. No snippets, messages, secret values or SARIF mutation.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib')
function location(l, artifacts=[]) {
 const p=l?.physicalLocation;if(!p)throw new Error('Missing physical SARIF location')
 const ref=p.artifactLocation; const uri=ref?.uri??artifacts[ref?.index]?.location?.uri
 if(typeof uri!=='string'||uri.includes('://')||uri.includes('?'))throw new Error('Non-relative SARIF location')
 return {path:uri,startLine:p.region?.startLine??null,endLine:p.region?.endLine??p.region?.startLine??null}
}
function project(sarif) {
 if(!Array.isArray(sarif.runs)||!sarif.runs.length)throw new Error('SARIF runs missing')
 return sarif.runs.flatMap(run=>(run.results??[]).map((r,index)=>({index,ruleId:r.ruleId,ruleMetadata:(()=>{const rule=run.tool?.driver?.rules?.find(rule=>rule.id===r.ruleId);return {securitySeverity:rule?.properties?.['security-severity']??null,level:r.level??rule?.defaultConfiguration?.level??null}})(),locations:(r.locations??[]).map(l=>location(l,run.artifacts)).filter(Boolean),fingerprints:Object.fromEntries(Object.entries(r.partialFingerprints??{}).filter(([k,v])=>k==='primaryLocationLineHash'&&typeof v==='string'&&/^[a-f0-9:]{1,128}$/.test(v))),flows:(r.codeFlows??[]).flatMap(f=>(f.threadFlows??[]).map(t=>t.locations.map(l=>location(l.location,run.artifacts)).filter(Boolean))),related:(r.relatedLocations??[]).map(l=>location(l,run.artifacts)).filter(Boolean)})))
}
function pages(rows){
 // Compression is transport only, AFTER strict projection; no raw SARIF input.
 const payload=zlib.deflateSync(Buffer.from(JSON.stringify(rows))).toString('base64'),size=2000,count=Math.max(1,Math.ceil(payload.length/size))
 if(count>8)throw new Error('Metadata overflow, not complete')
 return Array.from({length:count},(_,i)=>({page:i+1,pages:count,total:rows.length,encoding:'deflate-base64',payload:payload.slice(i*size,(i+1)*size),coverageComplete:true}))
}
function main(directory){const files=fs.readdirSync(directory).filter(n=>n.endsWith('.sarif'));if(!files.length)throw new Error('SARIF missing');const rows=files.flatMap(n=>project(JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))));const chunks=pages(rows);for(const p of chunks)console.log('::notice title=CodeQL flow inventory '+p.page+'/'+p.pages+'::'+JSON.stringify({...p,total:rows.length,coverageComplete:true}).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'))}
module.exports={project,pages}
if(require.main===module){try{main(process.argv[2])}catch(e){const reason=['Non-relative SARIF location','Metadata overflow, not complete','SARIF missing','Missing physical SARIF location','SARIF runs missing'].includes(e.message)?e.message:'unreadable SARIF structure';console.error('::error::CodeQL metadata inventory incomplete ('+reason+'); no raw SARIF published');process.exitCode=1}}

'use strict'
// Read-only SARIF projection. No snippets, messages, secret values or SARIF mutation.
const fs=require('node:fs'),path=require('node:path')
function location(l) {
 const p=l?.physicalLocation;if(!p)return null
 const uri=p.artifactLocation?.uri
 if(typeof uri!=='string'||uri.includes('://')||uri.includes('?'))throw new Error('Non-relative SARIF location')
 return {path:uri,startLine:p.region?.startLine??null,endLine:p.region?.endLine??p.region?.startLine??null}
}
function project(sarif) {
 return (sarif.runs??[]).flatMap(run=>(run.results??[]).map((r,index)=>({index,ruleId:r.ruleId,locations:(r.locations??[]).map(location).filter(Boolean),fingerprints:r.partialFingerprints??{},flows:(r.codeFlows??[]).flatMap(f=>(f.threadFlows??[]).map(t=>t.locations.map(l=>location(l.location)).filter(Boolean))),related:(r.relatedLocations??[]).map(location).filter(Boolean)})))
}
function pages(rows){const chunks=[];let chunk=[];for(const r of rows){if(Buffer.byteLength(JSON.stringify(r))>2200)throw new Error('Single result exceeds transport; full flow inventory unavailable');if(Buffer.byteLength(JSON.stringify([...chunk,r]))>2400&&chunk.length){chunks.push(chunk);chunk=[]}chunk.push(r)}if(chunk.length||!chunks.length)chunks.push(chunk);if(chunks.length>8)throw new Error('Metadata overflow, not complete');return chunks.map((rows,i)=>({page:i+1,pages:chunks.length,rows}))}
function main(directory){const files=fs.readdirSync(directory).filter(n=>n.endsWith('.sarif'));if(!files.length)throw new Error('SARIF missing');const rows=files.flatMap(n=>project(JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))));const chunks=pages(rows);for(const p of chunks)console.log('::notice title=CodeQL flow inventory '+p.page+'/'+p.pages+'::'+JSON.stringify({...p,total:rows.length,coverageComplete:true}).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'))}
module.exports={project,pages}
if(require.main===module){try{main(process.argv[2])}catch{console.error('::error::CodeQL metadata inventory incomplete; no raw SARIF published');process.exitCode=1}}

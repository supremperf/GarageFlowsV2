'use strict'
/** Offline intake ONLY. No inference, gold generation, database, network or paid call. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{z}=require('zod')
const dimensions=['novel_intent','compound','conversation','time_status','missing_information','out_of_scope','tools_parameters','permissions_business_facts']
const expected=z.object({intent:z.string().min(1).max(50),modes:z.array(z.enum(['answer','clarify','unknown','help','action_proposal','denied'])).min(1),tools:z.array(z.string().min(1).max(40)).max(3),parameters:z.record(z.string(),z.record(z.string(),z.union([z.string().max(500),z.number().finite(),z.boolean()]))),action:z.string().max(40).optional(),articles:z.array(z.string().max(40)).max(3)}).strict()
const Intake=z.object({version:z.literal(1),externalReviewerRef:z.string().min(3).max(150),independentOfImplementation:z.literal(true),blindReviewed:z.literal(true),cases:z.array(z.object({id:z.string().regex(/^B\d{3}$/),dimension:z.enum(dimensions),query:z.string().trim().min(1).max(500),role:z.enum(['OWNER','MANAGER','RECEPTIONIST','MECHANIC','UNKNOWN']),history:z.array(z.string().trim().min(1).max(500)).max(6),expected,factOracleRef:z.string().min(3).max(200).nullable()}).strict()).length(32)}).strict()
const norm=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim()
function validateIntake(input,root=path.resolve(__dirname,'..')) {
 const corpus=Intake.parse(input)
 const seen=new Set(),existing=new Set(['evaluation-cases.json','evaluation-phase3.json','evaluation-phase4-validation.json'].flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,'src/lib/copilot',f)))).map(c=>norm(c.query)))
 const {loader}=require('./evaluate-copilot.cjs');const {TOOLS,validateCall}=loader(false)('src/lib/copilot/tools.ts')
 for(const c of corpus.cases){
  if(seen.has(c.id)||existing.has(norm(c.query)))throw new Error('Duplicate/development/frozen overlap')
  seen.add(c.id);existing.add(norm(c.query))
  if(new Set(c.expected.tools).size!==c.expected.tools.length||c.expected.tools.some(id=>!TOOLS.some(t=>t.kind==='read'&&t.id===id)))throw new Error('Unknown/duplicate read tool')
  if(Object.keys(c.expected.parameters).some(id=>!c.expected.tools.includes(id)))throw new Error('Unbound gold parameters')
  for(const id of c.expected.tools)validateCall({toolId:id,input:c.expected.parameters[id]??{}},c.role)
  if(c.dimension==='permissions_business_facts'&&!c.factOracleRef)throw new Error('Missing native/permission oracle reference')
 }
 for(const d of dimensions)if(corpus.cases.filter(c=>c.dimension===d).length!==4)throw new Error('Expected four externally authored cases per dimension')
 return corpus
}
function freeze(input,output) {
 const corpus=validateIntake(input),bytes=JSON.stringify(corpus,null,2)+'\n'
 const fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 return {sha256:crypto.createHash('sha256').update(bytes).digest('hex'),count:32,networkAttempted:false,modelCalls:0,independence:'CLAIMED_BY_EXTERNAL_REVIEWER; human provenance verification still mandatory',limits:'Structure, exact/normalized textual overlap and call schema only; not semantic independence, gold correctness, native facts or intelligence. Current live campaign remains blocked.'}
}
module.exports={Intake,dimensions,validateIntake,freeze}
if(require.main===module){try{const [input,output]=process.argv.slice(2);if(!input||!output||process.argv.length!==4)throw new Error('Expected input and new output');console.log(JSON.stringify(freeze(JSON.parse(fs.readFileSync(input,'utf8')),output),null,2))}catch{console.error('Blind intake rejected; no inferred gold or network calls. Details withheld.');process.exitCode=1}}

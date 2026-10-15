'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {dimensions,validateIntake,freeze}=require('../scripts/prepare-copilot-blind-set.cjs')
// Schema fixtures are intentionally NOT an independent evaluation dataset.
const fixture=()=>({version:1,externalReviewerRef:'SYNTHETIC_SCHEMA_UNIT_ONLY',independentOfImplementation:true,blindReviewed:true,cases:dimensions.flatMap((d,i)=>Array.from({length:4},(_,j)=>({id:'B'+String(i*4+j).padStart(3,'0'),dimension:d,query:`SYNTHETIC SCHEMA FIXTURE ${i}-${j}`,role:'OWNER',history:[],expected:{intent:'out_of_scope',modes:['unknown'],tools:[],parameters:{},articles:[]},factOracleRef:'SYNTHETIC_ORACLE_NOT_EXECUTED'})))})
test('validates structural intake without pretending unit fixtures are independent',()=>assert.equal(validateIntake(fixture()).cases.length,32))
test('rejects overlap, duplicate IDs, incomplete strata, false independence and extra fields',()=>{
 const a=fixture();a.cases[0].query=JSON.parse(fs.readFileSync('src/lib/copilot/evaluation-phase4-validation.json','utf8'))[0].query
 const b=fixture();b.cases[1].id=b.cases[0].id
 const c=fixture();c.cases[0].dimension=dimensions[1]
 for(const x of [a,b,c,{...fixture(),blindReviewed:false},{...fixture(),independentOfImplementation:false},{...fixture(),extra:true}])assert.throws(()=>validateIntake(x))
})
test('rejects fabricated tool/parameters, unauthorized gold calls and missing fact oracle',()=>{
 for(const change of [c=>{c.expected.tools=['arbitrary_sql']},c=>{c.expected.parameters={low_stock:{}}},c=>{c.role='MECHANIC';c.expected.tools=['margin'];c.expected.parameters={margin:{}}},c=>{c.dimension='permissions_business_facts';c.factOracleRef=null}]){const a=fixture();change(a.cases[0]);assert.throws(()=>validateIntake(a))}
})
test('freeze is exclusive, hash-bearing, offline and never overwrites an existing gold',()=>{
 const t=fs.mkdtempSync(path.join(os.tmpdir(),'gf-blind-schema-unit-'));try{const p=path.join(t,'unit.json');const r=freeze(fixture(),p);assert.equal(r.count,32);assert.equal(r.modelCalls,0);assert.throws(()=>freeze(fixture(),p),{code:'EEXIST'})}finally{fs.rmSync(t,{recursive:true,force:true})}
})

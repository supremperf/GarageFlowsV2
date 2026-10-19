import subprocess,json,pathlib,datetime,re
B=pathlib.Path(__file__).resolve().parent
argv=['gh','api','repos/supremperf/GarageFlowsV2/check-runs/115939685204/annotations?per_page=100'];p=subprocess.run(argv,capture_output=True,text=True,timeout=60);out=[]
if p.returncode==0:
 for a in json.loads(p.stdout):
  if a.get('path')!='src/integration/invoice-authz.test.ts':continue
  text=a.get('message','')+'\n'+a.get('raw_details','');docs=[];dec=json.JSONDecoder()
  # Parse complete JSON objects if the assertion includes them. Never export values.
  for m in re.finditer(r'\{',text):
   try:
    v,end=dec.raw_decode(text[m.start():])
    if isinstance(v,dict) and 'data' in v:docs.append(v)
   except json.JSONDecodeError:pass
  safe_keys={'data','id','garageId','number','lines','unitCost','unitCostTenThousandths','unitPrice','unitPriceTenThousandths','description','pagination','createdAt','updatedAt','itemsJson','worksJson','partsJson','total','totalHT','totalTTC','quantityTenThousandths'};paths=[]
  def visit(v,path):
   if isinstance(v,dict):
    for k,val in v.items():visit(val,path+'.'+(k if k in safe_keys else '[other-field]'))
   elif isinstance(v,list):
    for i,val in enumerate(v):visit(val,path+f'[{i}]')
   elif '400000' in str(v):paths.append({'jsonPath':path,'valueType':type(v).__name__,'exactNumberOrString':v in [400000,'400000'],'valueWithheld':True})
  for d in docs:visit(d,'$')
  out.append({'path':a['path'],'line':a['start_line'],'messageCharacters':len(text),'assertionClass':'AssertionError' if 'AssertionError' in text else None,'negatedContainmentAssertion':bool(re.search(r'(?:not (?:to )?(?:contain|include)|not\.toContain)',text)),'completeResponseObjectsParsed':len(docs),'fixtureMarkerLocations':paths,'rawMessageWithheld':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':'38589332331','headSha':'64619b6270d7923167130246c061ad5773e3f29a','jobId':115939685204,'argv':argv,'exitCode':p.returncode,'analysis':out,'limits':'Only paths/types of occurrences of the known cost fixture marker exported, never response values. Empty parsed objects do not establish absence of disclosure. No speculative root-cause correction from incomplete annotations.'}
(B/'ci-assertion-analysis.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x,indent=2))

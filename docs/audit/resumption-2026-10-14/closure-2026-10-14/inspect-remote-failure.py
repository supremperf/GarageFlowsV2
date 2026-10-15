import subprocess,json,pathlib,re,datetime
B=pathlib.Path(__file__).resolve().parent
argv=['gh','api','repos/supremperf/GarageFlowsV2/check-runs/115939685204/annotations?per_page=100']
p=subprocess.run(argv,capture_output=True,text=True,timeout=60);rows=[]
if p.returncode==0:
 for a in json.loads(p.stdout):
  if a.get('path')!='src/integration/invoice-authz.test.ts':continue
  text=a.get('message','')+'\n'+a.get('raw_details','');patterns=[r'\bTypeError\b',r'\bAssertionError\b',r'\bPrismaClientInitializationError\b',r'Cannot read properties of undefined \(reading \'(?:0|data|lines)\'\)',r'expected \d{3} to be \d{3}',r'expected undefined',r'Test timed out in \d+ms',r'Hook timed out in \d+ms']
  rows.append({'path':a['path'],'start_line':a['start_line'],'end_line':a['end_line'],'safeMarkers':[m.group() for pat in patterns for m in re.finditer(pat,text)],'rawMessageWithheld':True})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':'38589332331','headSha':'64619b6270d7923167130246c061ad5773e3f29a','jobId':115939685204,'argv':argv,'exitCode':p.returncode,'annotations':rows,'limitation':'Safe annotation markers do not establish backend/root cause. Full expurgated test/HTTP response logs still required; latest 4989 check success does not retroactively repair this run.'}
(B/'remote-test-failure.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x,indent=2))

import subprocess,json,datetime,pathlib
B=pathlib.Path(__file__).resolve().parent
run=json.loads((B/'ci-runs.json').read_text())[0];rows=[]
for j in run['jobs']:
 argv=['gh','api',f'repos/supremperf/GarageFlowsV2/actions/jobs/{j["databaseId"]}'];p=subprocess.run(argv,capture_output=True,text=True,timeout=45)
 row={'argv':argv,'exitCode':p.returncode,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if p.returncode==0:
  x=json.loads(p.stdout);row.update({k:x.get(k) for k in ['id','run_id','run_attempt','head_sha','name','status','conclusion','started_at','completed_at','html_url','runner_name','runner_group_name','labels']});row['steps']=[{k:s.get(k) for k in ['name','number','status','conclusion','started_at','completed_at']} for s in x.get('steps',[])]
  a=x.get('started_at');b=x.get('completed_at');row['durationSeconds']=(datetime.datetime.fromisoformat(b.replace('Z','+00:00'))-datetime.datetime.fromisoformat(a.replace('Z','+00:00'))).total_seconds() if a and b else None
 rows.append(row)
needs={'Windows candidate packaging and inspection (not publication)':['Full dependency tree — zero vulnerabilities','Secret scan (Gitleaks)','Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL)','E2E (Playwright — responsive, auto-démarrage)'],'Authenticated browser validation (approved staging only)':['Full dependency tree — zero vulnerabilities','Secret scan (Gitleaks)','Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL)','E2E (Playwright — responsive, auto-démarrage)']}
byname={r.get('name'):r for r in rows};inconsistencies=[]
for child,parents in needs.items():
 c=byname.get(child,{})
 for parent in parents:
  p=byname.get(parent,{})
  if c.get('started_at') and p.get('completed_at') and c['started_at']<p['completed_at']:inconsistencies.append({'child':child,'parent':parent,'childStartedAt':c['started_at'],'parentCompletedAt':p['completed_at']})
x={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':run['runId'],'expectedHeadSha':run['headSha'],'jobs':rows,'timestampDependencyInconsistencies':inconsistencies,'limits':'Actual API timestamps preserved. Any dependency timing inconsistency is not silently repaired or used to assert runner execution ordering. Job success/conclusion does not prove unskipped cases inside a test process.'}
(B/'ci-job-details.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps({'jobs':len(rows),'requestsFailed':sum(r['exitCode']!=0 for r in rows),'timestampDependencyInconsistencies':len(inconsistencies)},indent=2))

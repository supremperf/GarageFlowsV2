from run import *
x=json.loads((B/'evidence/ci-jobs-later.log').read_text());rows=[]
for j in x['jobs']:
 argv=['gh','api',f'repos/supremperf/GarageFlowsV2/actions/jobs/{j["id"]}']; t=now();p=subprocess.run(argv,capture_output=True,text=True,timeout=45)
 row={'argv':argv,'exitCode':p.returncode,'observedAt':t}
 if p.returncode==0:
  q=json.loads(p.stdout);assert q['head_sha']==identity()['head']
  row.update({k:q.get(k) for k in ['id','run_id','head_sha','name','status','conclusion','started_at','completed_at','html_url','labels']})
  row['steps']=[{k:s.get(k) for k in ['name','number','status','conclusion','started_at','completed_at']} for s in q.get('steps',[])]
 rows.append(row)
(B/'ci-final-jobs.json').write_text(json.dumps(rows,indent=2)+'\n')
logs=[]
for id in [115948268697,115948268736]:
 argv=['gh','api',f'repos/supremperf/GarageFlowsV2/actions/jobs/{id}/logs'];t=now();p=subprocess.run(argv,capture_output=True,timeout=60)
 logs.append({'argv':argv,'startedAt':t,'finishedAt':now(),'exitCode':p.returncode,'stdoutBytes':len(p.stdout),'eofObserved':b'EOF' in p.stderr,'rawOutputWithheld':True,'limits':'Failure reason not inferred from EOF. Any signed redirect query omitted; no raw runner output published.'})
(B/'historical-log-access.json').write_text(json.dumps(logs,indent=2)+'\n');print(json.dumps({'jobs':len(rows),'failedRequests':sum(r['exitCode']!=0 for r in rows),'historicalLogDownloads':logs},indent=2))

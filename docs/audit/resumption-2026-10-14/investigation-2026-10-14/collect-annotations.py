"""Retrieve only annotation location metadata. Never persist arbitrary log/snippet text."""
import subprocess,json,pathlib,datetime,sys
B=pathlib.Path(__file__).resolve().parent
run=int(sys.argv[1]);label=sys.argv[2]
meta=json.loads(subprocess.check_output(['gh','run','view',str(run),'--json','jobs,headSha,conclusion,status,url']))
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'run':run,'commit':meta['headSha'],'runConclusion':meta['conclusion'],'jobs':[]}
for job in meta['jobs']:
 if job['conclusion']!='failure' and 'Gitleaks' not in job['name']:continue
 jid=job['databaseId']
 details=json.loads(subprocess.check_output(['gh','api',f'repos/supremperf/GarageFlowsV2/actions/jobs/{jid}']))
 check=details['check_run_url']
 checkmeta=json.loads(subprocess.check_output(['gh','api',check]))
 p=subprocess.run(['gh','api',check+'/annotations?per_page=100','--paginate'],capture_output=True,text=True)
 row={'id':jid,'name':job['name'],'conclusion':job['conclusion'],'url':job['url'],'apiExit':p.returncode,'annotations':[],'checkRunUrl':check,'declaredAnnotationCount':checkmeta.get('output',{}).get('annotations_count')}
 if p.returncode==0:
  pages=[];pending=p.stdout;decoder=json.JSONDecoder()
  while pending.strip():
   page,end=decoder.raw_decode(pending.lstrip());pages.append(page);pending=pending.lstrip()[end:]
  for page in pages:
   for a in page:
    item={k:a.get(k) for k in ['path','start_line','end_line','annotation_level','title']}
    # Only our generated scanner metadata, standard exit and GitHub runner notices.
    m=a.get('message','')
    if m.startswith(('EN ATTENTE DE REVUE; scope=working-tree; commit=', 'Process completed with exit code ', 'Gitleaks inventory:')):item['safeMessage']=m
    else:item['messageWithheld']=True
    row['annotations'].append(item)
 else:row['diagnostic']='CLI unsupported option' if 'unknown flag' in p.stderr else 'GitHub annotations retrieval failed; details not persisted.'
 result['jobs'].append(row)
(B/(label+'.json')).write_text(json.dumps(result,indent=2))
print(json.dumps({'run':run,'commit':meta['headSha'],'jobs':[{'name':j['name'],'apiExit':j['apiExit'],'annotations':len(j['annotations']),'gitleaksLocations':sum(a.get('title','').startswith('Gitleaks ') and a.get('title') not in ['Gitleaks inventory','Gitleaks installer'] for a in j['annotations'])} for j in result['jobs']]},indent=2))

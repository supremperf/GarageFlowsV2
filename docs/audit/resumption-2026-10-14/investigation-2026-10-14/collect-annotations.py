"""Retrieve only annotation location metadata. Never persist arbitrary log/snippet text."""
import subprocess,json,pathlib,datetime,sys
B=pathlib.Path(__file__).resolve().parent
run=int(sys.argv[1]);label=sys.argv[2]
meta=json.loads(subprocess.check_output(['gh','run','view',str(run),'--json','jobs,headSha,conclusion,status,url']))
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'run':run,'commit':meta['headSha'],'runConclusion':meta['conclusion'],'jobs':[]}
for job in meta['jobs']:
 if job['conclusion']!='failure':continue
 jid=job['databaseId'];p=subprocess.run(['gh','api',f'repos/supremperf/GarageFlowsV2/check-runs/{jid}/annotations','--paginate','--slurp'],capture_output=True,text=True)
 row={'id':jid,'name':job['name'],'conclusion':job['conclusion'],'url':job['url'],'apiExit':p.returncode,'annotations':[]}
 if p.returncode==0:
  for page in json.loads(p.stdout):
   for a in page:
    item={k:a.get(k) for k in ['path','start_line','end_line','annotation_level','title']}
    # Only our generated scanner metadata, standard exit and GitHub runner notices.
    m=a.get('message','')
    if m.startswith(('EN ATTENTE DE REVUE; scope=working-tree; commit=', 'Process completed with exit code ', 'Gitleaks inventory:')):item['safeMessage']=m
    else:item['messageWithheld']=True
    row['annotations'].append(item)
 else:row['diagnostic']='GitHub annotations API inaccessible; raw response omitted.'
 result['jobs'].append(row)
(B/(label+'.json')).write_text(json.dumps(result,indent=2))
print(json.dumps({'run':run,'commit':meta['headSha'],'jobs':[{'name':j['name'],'apiExit':j['apiExit'],'annotations':len(j['annotations']),'gitleaksLocations':sum(a.get('title','').startswith('Gitleaks ') for a in j['annotations'])} for j in result['jobs']]},indent=2))

from run import *
repo='repos/supremperf/GarageFlowsV2'
r=run('ci-run',['gh','api',repo+'/actions/runs/38602614687'])
if r['exitCode']==0:
 x=json.loads((B/'evidence/ci-run.log').read_text());assert x['head_sha']=='f88f2832eb256310852ed86040057c062d44433e'
 r=run('ci-jobs',['gh','api',repo+'/actions/runs/38602614687/jobs?per_page=100'])
 if r['exitCode']==0:
  j=json.loads((B/'evidence/ci-jobs.log').read_text())
  print('CI',x['status'],x['conclusion'],[(a['name'],a['conclusion']) for a in j['jobs']])
  for job in j['jobs']:
   run('ci-annotations-'+str(job['id']),['gh','api',repo+'/check-runs/'+str(job['id'])+'/annotations?per_page=100'])

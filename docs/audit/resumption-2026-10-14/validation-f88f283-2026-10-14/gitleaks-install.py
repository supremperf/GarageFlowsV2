from run import *
import tempfile,tarfile
cache=pathlib.Path('/home/user/audit-resumption/.cache/gitleaks-validation-f88f283');cache.mkdir(exist_ok=False)
rows=[]
for name in ['gitleaks_8.24.3_checksums.txt','gitleaks_8.24.3_linux_x64.tar.gz']:
 argv=['curl','--fail','--silent','--show-error','--location','--connect-timeout','10','--max-time','45','--write-out','%{http_code}','--output',str(cache/name),'https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/'+name]
 t=now(); p=subprocess.run(argv,capture_output=True,timeout=50)
 rows.append({'argv':argv,'startedAt':t,'finishedAt':now(),'exitCode':p.returncode,'httpCode':p.stdout.decode() if p.stdout.isdigit() else None,'bytes':(cache/name).stat().st_size if (cache/name).exists() else 0,'diagnosticWithheld':True})
result={'version':'8.24.3','downloads':rows,'checksumVerified':False,'binaryExecuted':False,'scopeRequested':'current working tree via project scripts/gitleaks-ci.cjs; not git commit/history','status':'BLOQUÉ'}
if all(r['exitCode']==0 and r['bytes'] for r in rows):
 name=rows[1]['argv'][-1].rsplit('/',1)[1]
 line=next(l for l in (cache/rows[0]['argv'][-1].rsplit('/',1)[1]).read_text().splitlines() if l.endswith('  '+name))
 actual=hashlib.sha256((cache/name).read_bytes()).hexdigest();assert actual==line.split()[0]
 result.update(checksumVerified=True,archiveSha256=actual)
 with tarfile.open(cache/name) as a:
  m=a.getmember('gitleaks');assert m.isfile();(cache/'gitleaks').write_bytes(a.extractfile(m).read());(cache/'gitleaks').chmod(0o700)
 result.update(binaryExecuted=True,status='PARTIELLEMENT VALIDÉ')
 run('gitleaks-version',[str(cache/'gitleaks'),'version'])
 run('gitleaks-current-tree',['node','scripts/gitleaks-ci.cjs'],600,{'PATH':str(cache)+':'+ENV['PATH'],'GITHUB_SHA':identity()['head']})
(B/'gitleaks-prerequisite.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

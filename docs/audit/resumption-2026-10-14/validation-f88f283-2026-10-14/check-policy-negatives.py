from run import *
import tempfile,shutil
C=B.parent/'investigation-2026-10-14'
rows=list(map(json.loads,(C/'gitleaks-triage.jsonl').read_text().splitlines()))
paths=['.gitleaks.toml','.gitleaksignore','tests/secret-scan-policy.test.cjs',str((C/'gitleaks-triage.jsonl').relative_to(ROOT)),str((B/'gitleaks-triage.jsonl').relative_to(ROOT))]
paths+= [r['path'] for r in rows if r.get('classification')=='PUBLIC_OAUTH_CLIENT_IDENTIFIER']
paths+=['docs/audit/resumption-2026-10-14/closure-2026-10-14/REPORT.md']
results=[]
with tempfile.TemporaryDirectory(prefix='gf-policy-negative-') as d:
 tmp=pathlib.Path(d)
 for p in paths:
  dest=tmp/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,dest)
 for label,path,addition,expected in [('baseline',None,None,0),('changed-frozen-prose',paths[-1],'\n',1),('changed-public-header',paths[-2],'\n',1),('unapproved-fingerprint','.gitleaksignore','\nother-path:generic-api-key:1\n',1)]:
  original=(tmp/path).read_bytes() if path else None
  if path:(tmp/path).write_bytes(original+addition.encode())
  argv=['node','--test','tests/secret-scan-policy.test.cjs'];t=now();p=subprocess.run(argv,cwd=tmp,capture_output=True)
  results.append({'id':label,'argv':argv,'cwd':'isolated owned copies, no production files','startedAt':t,'finishedAt':now(),'exitCode':p.returncode,'expectedExitCode':expected,'childOutputWithheld':True})
  assert p.returncode==expected, label
  if path:(tmp/path).write_bytes(original)
(B/'policy-negative-results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))

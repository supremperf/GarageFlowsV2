from run import *
import platform
started=now()
# All control processes have ended before this read-only check and evidence freeze.
check=subprocess.run(['python3',str((B/'verify-current.py').relative_to(ROOT))],cwd=ROOT,capture_output=True,text=True)
assert check.returncode==0,check.stderr
receipts=sorted((json.loads(p.read_text()) for p in (B/'evidence').glob('*.command.json')),key=lambda r:(r['startedAt'],r['id']))
assert len(receipts)==len({r['id'] for r in receipts})
for r in receipts: assert hashlib.sha256((B/r['proof']).read_bytes()).hexdigest()==r['logSha256']
(B/'commands.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in receipts))
tools=[]
for p in sorted(B.iterdir()):
 if p.suffix not in ['.py','.cjs']:continue
 used=[r['id'] for r in receipts if any(str(p.relative_to(ROOT))==a for a in r['argv'])]
 tools.append({'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'status':'PARTIELLEMENT VALIDÉ','fullIndependentSemanticReview':False,'commands':used,'scope':'Audit evidence tooling only; generated/authored recipes are not automatically product runtime validations. Executed assertions/results appear in command receipts; nonexecuted recipe branches remain unvalidated.'})
(B/'evidence-tools-inventory.json').write_text(json.dumps(tools,indent=2)+'\n')
receipt={'argv':['python3',str((B/'freeze.py').relative_to(ROOT))],'cwd':str(ROOT),'startedAt':started,'finishedAt':now(),'timezone':'Europe/Paris',**identity(),'python':platform.python_version(),'commands':len(receipts),'verificationExitCode':check.returncode,'verificationSummary':json.loads(check.stdout),'status':'VALIDÉ','limits':'Evidence coherence/freeze only; negative scanner/test/build results retained. Manifest excludes itself and regenerable __pycache__, not applicable product source. No Git staging/commit/push or remote write.'}
(B/'freeze-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
entries=[]
for p in sorted(B.rglob('*')):
 if not p.is_file() or '__pycache__' in p.parts or p.name=='EVIDENCE-SHA256.jsonl':continue
 data=p.read_bytes();entries.append({'path':str(p.relative_to(B)),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
manifest=B/'EVIDENCE-SHA256.jsonl';manifest.write_text(''.join(json.dumps(r)+'\n' for r in entries))
for r in entries: assert hashlib.sha256((B/r['path']).read_bytes()).hexdigest()==r['sha256']
print(json.dumps({'proofFiles':len(entries),'bytes':sum(r['bytes'] for r in entries),'commands':len(receipts),'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'head':identity()['head'],'sourceFingerprint':identity()['sourceFingerprint'],'decision':'VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION'},ensure_ascii=False,indent=2))

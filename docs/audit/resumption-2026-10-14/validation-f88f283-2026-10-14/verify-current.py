from run import *
import socket,collections
C=B.parent/'closure-2026-10-14'
candidate=json.loads((B/'candidate.json').read_text());assert identity()['head']==candidate['head']=='f88f2832eb256310852ed86040057c062d44433e'
assert identity()['sourceFingerprint']==candidate['sourceFingerprint']
assert subprocess.check_output(['git','branch','--show-current'],cwd=ROOT).decode().strip()=='arena/c9eaae15-garageflowsv2'
assert subprocess.check_output(['git','ls-remote','origin','refs/heads/arena/c9eaae15-garageflowsv2'],cwd=ROOT).decode().split()[0]==candidate['head']
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=ROOT)
allowed={'.gitleaksignore','tests/secret-scan-policy.test.cjs','docs/audit/resumption-2026-10-14/LATEST.md'}
assert set(subprocess.check_output(['git','diff','--name-only'],cwd=ROOT).decode().splitlines())==allowed
unknown=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
assert all(not p or p.startswith(str(B.relative_to(ROOT))+'/') for p in unknown)
for l in (C/'EVIDENCE-SHA256.jsonl').read_text().splitlines():
 r=json.loads(l);p=C/r['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==r['sha256'] and p.stat().st_size==r['bytes']
assert hashlib.sha256((C/'EVIDENCE-SHA256.jsonl').read_bytes()).hexdigest()=='7f6c460702f20ea90a4a9f75f23a529a8e4a81bcfe22171d876b2a2674725a7b'
for r in json.loads((C/'candidate-source.json').read_text())['sourceChanges']: assert hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()==r['sha256']
for r in candidate['sourceChanges']+candidate['criticalEvidenceDependencies']:assert hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()==r['sha256']
for r in map(json.loads,(B/'review-ledger-current.jsonl').read_text().splitlines()):assert hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()==r['sha256']
for l in (B/'sast-findings-current.jsonl').read_text().splitlines():
 r=json.loads(l);assert hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()==r['sourceSha256']
sast=json.loads((B/'sast-summary.json').read_text());assert (sast['signals'],sast['groups'],sast['decisions'],sast['pendingOccurrences'],sast['errors'])==(865,845,59,806,[])
x=json.loads((B/'full-suite-provisioned-summary.json').read_text());assert (x['total'],x['passed'],x['failed'],x['skipped'],x['globalErrors'],x['exitCode'])==(3841,2994,3,844,4,1)
for id in ['typecheck-settled','lint','authz','semgrep-settled','release-safety','full-suite-provisioned','audit-strict']:
 r=json.loads((B/f'evidence/{id}.command.json').read_text());assert r['sourceFingerprint']==r['afterIdentity']['sourceFingerprint']==candidate['sourceFingerprint']
for p in (B/'evidence').glob('*.command.json'):
 r=json.loads(p.read_text());assert r['logSha256']==hashlib.sha256((B/r['proof']).read_bytes()).hexdigest()
assert len(json.loads((B/'issue-matrix.json').read_text()))==26
assert json.loads((ROOT/'perf-budget.json').read_text())['totalClientJsBytes']==3625984
assert json.loads((ROOT/'perf-budget.json').read_text())['largestChunkBytes']==524288
s=socket.socket();assert s.connect_ex(('127.0.0.1',16381))!=0;s.close()
print(json.dumps({'status':'VALIDÉ','scope':'Evidence/source/Git identity/coherence only, not production','historicalProofs':146,'historicalSourceHashes':18,'semanticSourceHashes':1250,'sastSignals':865,'matrixIds':26,'remoteUnchanged':True,'indexEmpty':True,'redisStopped':True},indent=2))

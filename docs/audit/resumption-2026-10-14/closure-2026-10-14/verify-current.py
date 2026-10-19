"""Read-only evidence coherence, not a security/production certificate."""
from pathlib import Path
import json,hashlib,subprocess,collections,stat,re,datetime
B=Path(__file__).resolve().parent;ROOT=B.parents[3];P=B.parent/'investigation-2026-10-14'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
load=lambda p:json.loads(p.read_text())
lines=lambda p:[json.loads(l) for l in p.read_text().splitlines()]
assert subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()=='arena/c9eaae15-garageflowsv2'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()=='4989b53d4a8f10cf8afb2f7c579d1de354f58508'
candidate=load(B/'candidate-source.json');assert not candidate['committed'] and not candidate['published']
patch=subprocess.check_output(['git','diff','--binary','HEAD','--','src','electron','scripts','tests','.github','package.json','package-lock.json'],cwd=ROOT);assert hashlib.sha256(patch).hexdigest()==candidate['sourceDeltaSha256']==sha(B/'source-changes.patch')
assert len(candidate['sourceChanges'])==18
for r in candidate['sourceChanges']:assert sha(ROOT/r['path'])==r['sha256']
# Published evidence bytes are immutable; changed product bytes have new ledgers.
for manifest,base in [(P/'EVIDENCE-SHA256.jsonl',P),(P.parent/'EVIDENCE-SHA256-at-77558ca.jsonl',P.parent)]:
 for r in lines(manifest):assert sha(base/r['path'])==r['sha256'],str(base/r['path'])
initial=load(P.parent/'initial-state.json')
assert sha(ROOT/'docs/audit/REPORT-2026-10-14.md')==initial['historicalReportSha256']
assert sha(ROOT/'docs/audit/followup-2026-10-14/REPORT.md')==initial['followupReportSha256']
reviews=lines(B/'review-ledger-final.jsonl');assert len(reviews)==len({r['path'] for r in reviews})==1250
for r in reviews:
 p=ROOT/r['path'];assert stat.S_ISREG(p.lstat().st_mode);assert sha(p)==r['sha256'],r['path']
summary=load(B/'review-progress-final.json');counts=collections.Counter(r['manualReview']['status'] for r in reviews);assert dict(counts)==summary['manualReview']=={'VALIDÉ':72,'PARTIELLEMENT VALIDÉ':43,'EN ATTENTE DE REVUE':1135}
assert sum(r['manualReview']['fullFileRead'] for r in reviews)==85
# Compare actual inventory using the same explicitly documented exclusions.
excluded=['docs/audit/followup-2026-10-14/','docs/audit/resumption-2026-10-14/'];generated={'docs/audit/inventory.jsonl','docs/audit/inventory-current.jsonl','docs/audit/module-map.jsonl','docs/audit/scope.json'}
names=set(subprocess.check_output(['git','ls-files','-c','-o','--exclude-standard','-z'],cwd=ROOT).decode().split('\0'))-{''}
applicable={p for p in names if p not in generated and not any(p.startswith(d) for d in excluded) and ((ROOT/p).is_file() or (ROOT/p).is_symlink())}
assert applicable=={r['path'] for r in reviews},sorted(applicable^{r['path'] for r in reviews})
findings=lines(B/'sast-findings-final.jsonl');assert len(findings)==len({r['id'] for r in findings})==865
for r in findings:assert sha(ROOT/r['path'])==r['sourceSha256']
assert {r['id'] for r in findings}=={r['id'] for r in lines(P/'sast-findings-final.jsonl')}
groups=load(B/'sast-location-groups-final.json');assert len(groups)==845 and sum(len(r['allOccurrenceIds']) for r in groups)==865
assert collections.Counter(i for r in groups for i in r['allOccurrenceIds'])==collections.Counter(r['id'] for r in findings)
byid={r['id']:r for r in findings}
for g in groups:
 for rid in g['allOccurrenceIds']:
  r=byid[rid];assert (r['ruleId'],r['path'],r['start']['line'],r['start']['col'],r['end']['line'],r['end']['col'])==(g['ruleId'],g['path'],g['start']['line'],g['start']['col'],g['end']['line'],g['end']['col'])
triage=lines(B/'sast-triage-final.jsonl');assert len(triage)==len({r['id'] for r in triage})==27
for r in triage:assert r['sourceSha256']==byid[r['id']]['sourceSha256']
assert collections.Counter(r['status'] for r in triage)=={'VALIDÉ':13,'PARTIELLEMENT VALIDÉ':14}
overlay=lines(B/'sast-review-register.jsonl');assert len(overlay)==845
assert collections.Counter(r['status'] for r in overlay)=={'VALIDÉ':13,'PARTIELLEMENT VALIDÉ':12,'EN ATTENTE DE REVUE':820}
assert sum(len(r['untriagedOccurrenceIds']) for r in overlay)==838
assert collections.Counter(i for r in overlay for i in r['allOccurrenceIds'])==collections.Counter(r['id'] for r in findings)
scan=load(B/'sast-summary-final.json');assert scan['errors']==[] and scan['selected']==scan['targets']==996
for r in load(B/'semgrep-targets-final.json')['targets']:assert sha(ROOT/r['path'])==r['sha256']
refactor=load(B/'parser-refactor.json');assert len(refactor['rows'])==15 and sum(r['replacements'] for r in refactor['rows'])==17
for r in refactor['rows']:
 assert sha(ROOT/r['path'])==r['afterSha256'] and r['emittedJsIdentical'];assert hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+r['path']],cwd=ROOT)).hexdigest()==r['beforeSha256']
gaps=load(B/'parser-gaps-final.json');assert len(gaps)==15 and all(r['status']=='RÉSOLU' for r in gaps)
fixture=load(B/'fixture-correction.json');assert sha(ROOT/fixture['path'])==fixture['afterSha256'] and fixture['unchangedExpectLines']==16
before=subprocess.check_output(['git','show','HEAD:'+fixture['path']],cwd=ROOT,text=True);after=(ROOT/fixture['path']).read_text();expect=lambda text:[l.strip() for l in text.splitlines() if 'expect(' in l];assert expect(before)==expect(after)
cases=lines(B/'tests-all.jsonl');assert len(cases)==3841 and collections.Counter(r['runnerStatus'] for r in cases)=={'passed':2994,'failed':3,'skipped':844}
assert len(lines(B/'tests-skipped.jsonl'))==844 and len(lines(B/'tests-failed.jsonl'))==3
errors=load(B/'tests-global-errors.json');assert len(errors)==4 and all(r['queryEngineNotLocated'] and r['errorClass']=='PrismaClientInitializationError' for r in errors)
assert (B/'evidence/vitest-candidate.log').read_text().count('Unhandled Rejection')==4
for name,n in [('authz-after',205),('preserved-corrections',122),('gcm-historical-suite',94),('redis-real',5)]:
 x=load(B/'evidence'/f'{name}.json');assert x['numPassedTests']==x['numTotalTests']==n and x['numFailedTests']==0
oldtest=load(B/'evidence/authz-before.json');assert oldtest['numFailedTests']==12
assert '# pass 10' in (B/'evidence/backup-regression.log').read_text() and '# skipped 0' in (B/'evidence/backup-regression.log').read_text()
assert '# pass 52' in (B/'evidence/release-safety.log').read_text()
assert 'LOW=0 MODERATE=0 HIGH=0 CRITICAL=0 TOTAL=0' in (B/'evidence/audit-strict.log').read_text()
issues=load(B/'issue-matrix.json');assert len(issues)==len({r['id'] for r in issues})==26 and all(not r['releaseClosed'] for r in issues)
allowed={'RÉSOLU','VALIDÉ','PARTIELLEMENT VALIDÉ','ÉCHOUÉ','BLOQUÉ','EN ATTENTE DE REVUE'}
for r in issues:
 assert r['status'] in allowed
 for p in r['currentProof']:assert (B/p.split('#')[0]).is_file(),p
commands=lines(B/'commands.jsonl');assert len(commands)==len({r['id'] for r in commands})
for r in commands:assert (B/r['proof']).is_file(),r['id']
cmd={r['id']:r for r in commands}
for name,code in [('typecheck-candidate',0),('lint-final',0),('vitest-candidate',1),('semgrep-final',1),('standard-build-candidate',1),('audit-strict',0)]:assert cmd[name]['exitCode']==code
for name in ['vitest-candidate','semgrep-final','typecheck-candidate','standard-build-candidate']:assert cmd[name]['sourceDeltaSha256']==candidate['sourceDeltaSha256']
budget=load(ROOT/'perf-budget.json');assert budget['totalClientJsBytes']==3625984 and budget['largestChunkBytes']==524288
assert (ROOT/'perf-budget.json').read_bytes()==subprocess.check_output(['git','show','HEAD:perf-budget.json'],cwd=ROOT)
for p in ['package.json','package-lock.json','.github/workflows/ci.yml','.semgrepignore','.gitleaks.toml','.gitleaksignore']:assert (ROOT/p).read_bytes()==subprocess.check_output(['git','show','HEAD:'+p],cwd=ROOT)
g=load(B/'dependency-graph.json');nodes={n['id']:n for n in g['nodes']}
def visit(n,chain):
 assert n not in chain
 for d in nodes[n]['dependsOn']:visit(d,chain+[n])
for n in nodes:visit(n,[])
run=load(B/'ci-runs.json')[0];assert run['headSha']==candidate['baseHead'] and run['conclusion']=='failure' and run['status']=='completed'
details=load(B/'ci-job-details.json');assert len(details['jobs'])==8 and not details['timestampDependencyInconsistencies']
for j in details['jobs']:assert j['head_sha']==candidate['baseHead'] and str(j['run_id'])=='38591143098' and j['status']=='completed'
assert collections.Counter(j['conclusion'] for j in details['jobs'])=={'success':4,'failure':3,'skipped':1}
a=load(B/'ci-annotations.json');secret=next(j for j in a if j['runId']=='38591143098' and 'Gitleaks' in j['jobName']);assert any('findings=0' in r['safeMarkers'] and 'scannerExit=0' in r['safeMarkers'] for r in secret['annotations'])
assert load(B/'redis-runtime.json')['state']=='stopped'
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceDeltaSha256':candidate['sourceDeltaSha256'],'historicalEvidence':'unchanged','sourceHashes':1250,'semanticStatuses':dict(counts),'sastSignals':865,'exactGroups':845,'triages':27,'parserErrors':0,'testCases':3841,'skips':844,'globalErrors':4,'issues':26,'ci4989':'completed/failure; 4 success,3 failure,1 skipped','budget':'unchanged','limitations':'Coherence only, no security certification, no production readiness.'},indent=2))

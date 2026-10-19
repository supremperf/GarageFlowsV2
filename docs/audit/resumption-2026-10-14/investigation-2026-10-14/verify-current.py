"""Read-only coherence, never a production/security certificate."""
from pathlib import Path
import json,hashlib,subprocess,collections,re,datetime
B=Path(__file__).resolve().parent;ROOT=B.parents[3];old=B.parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert subprocess.check_output(['git','branch','--show-current'],text=True).strip()=='arena/c9eaae15-garageflowsv2'
initial=json.loads((old/'initial-state.json').read_text())
assert sha(ROOT/'docs/audit/REPORT-2026-10-14.md')==initial['historicalReportSha256']
assert sha(ROOT/'docs/audit/followup-2026-10-14/REPORT.md')==initial['followupReportSha256']
for line in (old/'EVIDENCE-SHA256-at-77558ca.jsonl').read_text().splitlines():
 r=json.loads(line);assert sha(old/r['path'])==r['sha256'],r['path']
reviews=list(map(json.loads,(B/'review-ledger.jsonl').read_text().splitlines()));assert len(reviews)==len({r['path'] for r in reviews})==1250
for r in reviews:assert sha(ROOT/r['path'])==r['sha256'],r['path']
assert collections.Counter(r['manualReview']['status'] for r in reviews)=={'VALIDÉ':69,'PARTIELLEMENT VALIDÉ':13,'EN ATTENTE DE REVUE':1168}
findings=list(map(json.loads,(B/'sast-findings-final.jsonl').read_text().splitlines()));assert len(findings)==len({r['id'] for r in findings})==865
for r in findings:assert sha(ROOT/r['path'])==r['sourceSha256'] and not r['staleForCurrentSource']
groups=json.loads((B/'sast-location-groups-final.json').read_text());assert len(groups)==845 and sum(len(g['allOccurrenceIds']) for g in groups)==865
assert {i for g in groups for i in g['allOccurrenceIds']}=={r['id'] for r in findings}
triage=list(map(json.loads,(B/'sast-triage-current.jsonl').read_text().splitlines()));assert len(triage)==17
cases=list(map(json.loads,(B/'tests-all.jsonl').read_text().splitlines()));assert len(cases)==3829
assert collections.Counter(r['runnerStatus'] for r in cases)=={'passed':2982,'failed':3,'skipped':844}
log=(B/'evidence/vitest-complete.log').read_text();assert len(re.findall('Unhandled Rejection',log))==4
issues=json.loads((B/'issue-matrix.json').read_text());assert len(issues)==len({r['id'] for r in issues})==26
allowed={'VALIDÉ','RÉSOLU','PARTIELLEMENT VALIDÉ','ÉCHOUÉ','BLOQUÉ','EN ATTENTE DE REVUE'}
for r in issues:
 assert r['status'] in allowed
 for p in r['currentProof']:assert (B/p.split('#')[0]).is_file(),p
commands=list(map(json.loads,(B/'commands.jsonl').read_text().splitlines()));assert len(commands)==len({r['id'] for r in commands})
for r in commands:assert (B/r['proof']).is_file()
graph=json.loads((B/'dependency-graph.json').read_text());nodes={n['id']:n for n in graph['nodes']}
def visit(name,chain):
 assert name not in chain
 for dep in nodes[name]['dependsOn']:visit(dep,chain+[name])
for name in nodes:visit(name,[])
budget=json.loads((ROOT/'perf-budget.json').read_text());assert '3625984' in json.dumps(budget) and '524288' in json.dumps(budget)
a=json.loads((B/'ci-triaged-annotations.json').read_text());inventory=[v for j in a['jobs'] for v in j['annotations'] if v['title']=='Gitleaks inventory'];assert len(inventory)==1
assert 'findings=0; scannerExit=0; commit=64619b6' in inventory[0]['safeMessage']
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'historicalEvidence':'unchanged','currentReviewHashes':1250,'sastRaw':865,'sastGroups':845,'triage':17,'cases':3829,'skips':844,'issues':26,'commands':len(commands),'graph':'acyclic','budget':'unchanged','gitleaksCommit646':'inventory0 exit0','limits':'Coherence only, no production/security certification.'},indent=2))

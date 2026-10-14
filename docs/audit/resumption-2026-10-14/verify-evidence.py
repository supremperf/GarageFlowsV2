"""Read-only audit coherence checks; no install, DB access, signing or publication."""
import datetime,hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];BASE=pathlib.Path(__file__).resolve().parent
initial=json.loads((BASE/'initial-state.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()=='arena/c9eaae15-garageflowsv2'
assert sha(ROOT/'docs/audit/REPORT-2026-10-14.md')==initial['historicalReportSha256']
assert sha(ROOT/'docs/audit/followup-2026-10-14/REPORT.md')==initial['followupReportSha256']
old=ROOT/'docs/audit/followup-2026-10-14'
old_manifest=[json.loads(l) for l in (old/'EVIDENCE-SHA256.jsonl').read_text().splitlines()]
# Accept the original manifest's actual path field; never mutate old evidence.
for r in old_manifest:
 p=old/r.get('path',r.get('file',''))
 assert p.is_file(),p
 assert sha(p)==r['sha256'],p
review=[json.loads(l) for l in (BASE/'review-ledger.jsonl').read_text().splitlines()]
for r in review:assert sha(ROOT/r['path'])==r['sha256'],r['path']
issues=json.loads((BASE/'issue-matrix.json').read_text());assert len(issues)==25 and len({r['id'] for r in issues})==25
for r in issues:
 for proof in r['currentProof']:assert (BASE/proof.split('#')[0]).is_file(),proof
commands=[json.loads(l) for l in (BASE/'commands.jsonl').read_text().splitlines()]
assert len({r['id'] for r in commands})==len(commands)
for r in commands:assert (BASE/r['proof']).is_file(),r['id']
graph=json.loads((BASE/'dependency-graph-current.json').read_text());nodes={n['id']:n for n in graph['nodes']};done=set()
def visit(name,chain):
 assert name not in chain,chain+[name]
 if name in done:return
 for dep in nodes[name]['dependsOn']:visit(dep,chain+[name])
 done.add(name)
for name in nodes:visit(name,[])
summary=json.loads((BASE/'tests-summary.json').read_text());assert summary['total']==3829 and summary['passed']==2982 and summary['failed']==3 and summary['skipped']==844 and summary['unhandledErrors']==4
budget=json.loads((ROOT/'perf-budget.json').read_text());assert '3625984' in json.dumps(budget) and '524288' in json.dumps(budget)
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timezone':'Europe/Paris','oldEvidenceFilesUnchanged':len(old_manifest),'currentReviewedSourceHashesVerified':len(review),'issues':len(issues),'commandsWithExistingLogs':len(commands),'dagNodes':len(nodes),'fixedBudgetVerified':True,'limitations':'Coherence/hash validation only, not functional/native/security certification.'},indent=2))

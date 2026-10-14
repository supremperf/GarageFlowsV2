"""Sanitize scanner results: no source snippets, bindings or error messages."""
import json,pathlib,hashlib,collections,datetime
B=pathlib.Path(__file__).resolve().parent;ROOT=B.parents[3]
rawpath=pathlib.Path('/home/user/audit-resumption/.cache/semgrep-investigation-result.json');x=json.loads(rawpath.read_text())
old=[json.loads(s) for s in (B.parent/'sast-findings.jsonl').read_text().splitlines()]
def key(r):return (r.get('ruleId',r.get('check_id')),r['path'],r['start']['line'],r['end']['line'])
prior={key(r):r for r in old};rows=[];nextid=865
for r in x['results']:
 e=r.get('extra',{});p=ROOT/r['path'];oldrow=prior.get(key(r));rid=oldrow['id'] if oldrow else f'SAST-20261014-{nextid:04d}'
 if not oldrow:nextid+=1
 rows.append({'id':rid,'ruleId':r['check_id'],'path':r['path'],'start':r['start'],'end':r['end'],'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'severity':e.get('severity'),'category':e.get('metadata',{}).get('category'),'status':'EN ATTENTE DE REVUE','issueId':'FUP-20261014-015','priorId':oldrow['id'] if oldrow else None})
errors=[]
for e in x.get('errors',[]):
 row={k:e[k] for k in ['code','type','path','spans','rule_id'] if k in e};row['sourceSha256']=hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest() if e.get('path') and (ROOT/e['path']).exists() else None;errors.append(row)
groups=collections.defaultdict(list)
for r in rows:groups[(r['path'],r['start']['line'],r['end']['line'])].append(r['id'])
manifest=json.loads((B/'semgrep-targets.json').read_text());scanned=set(x.get('paths',{}).get('scanned',[]));targets={r['path'] for r in manifest['targets']}
summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':x.get('version'),'rawSha256':hashlib.sha256(rawpath.read_bytes()).hexdigest(),'targets':len(targets),'selected':len(scanned),'missingTargets':sorted(targets-scanned),'rawSignals':len(rows),'uniqueRuleLocations':len({key(r) for r in rows}),'locationGroups':len(groups),'severities':dict(collections.Counter(r['severity'] for r in rows)),'categories':dict(collections.Counter(r['category'] for r in rows)),'errors':errors,'rules':dict(collections.Counter(r['ruleId'] for r in rows)),'limits':'No excerpts/Secret/Match/metavariables stored. Selected does not mean completely parsed. Same-location rules retained, not silently discarded. Scan predates later reporter inventory-line edit; current reporter source hash invalidates that file only.'}
(B/'sast-findings.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
(B/'sast-summary.json').write_text(json.dumps(summary,indent=2))
(B/'sast-location-groups.json').write_text(json.dumps([{'path':p,'startLine':s,'endLine':e,'findingIds':ids} for (p,s,e),ids in groups.items()],indent=2))
print(json.dumps({k:summary[k] for k in ['version','targets','selected','missingTargets','rawSignals','uniqueRuleLocations','locationGroups','severities','categories']},indent=2))

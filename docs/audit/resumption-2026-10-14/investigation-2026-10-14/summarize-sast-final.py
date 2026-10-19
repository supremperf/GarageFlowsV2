"""Exact-range SAST reconciliation; keep every raw occurrence, never source snippets."""
import pathlib,json,hashlib,datetime,collections,re
B=pathlib.Path(__file__).resolve().parent;ROOT=B.parents[3]
rawpath=pathlib.Path('/home/user/audit-resumption/.cache/semgrep-investigation-final-result.json');raw=json.loads(rawpath.read_text())
manifest=json.loads((B/'semgrep-targets-final.json').read_text());hashes={r['path']:r['sha256'] for r in manifest['targets']}
def normalize(rule):
 m=re.search(r'(?:javascript|typescript|python)\.',rule)
 assert m,rule
 return rule[m.start():]
def key(r):return (normalize(r.get('ruleId',r.get('check_id'))),r['path'],r['start']['line'],r['start']['col'],r['end']['line'],r['end']['col'])
prior=collections.defaultdict(collections.deque)
for r in map(json.loads,(B.parent/'sast-findings.jsonl').read_text().splitlines()):prior[key(r)].append(r)
rows=[];nextid=865
for r in raw['results']:
 e=r.get('extra',{});old=prior[key(r)].popleft() if prior[key(r)] else None
 rid=old['id'] if old else f'SAST-20261014-{nextid:04d}'
 if not old:nextid+=1
 current=hashlib.sha256((ROOT/r['path']).read_bytes()).hexdigest()
 rows.append({'id':rid,'ruleId':normalize(r['check_id']),'path':r['path'],'start':r['start'],'end':r['end'],'sourceSha256':hashes[r['path']],'currentSourceSha256':current,'staleForCurrentSource':current!=hashes[r['path']],'severity':e.get('severity'),'category':e.get('metadata',{}).get('category'),'status':'EN ATTENTE DE REVUE','issueId':'FUP-20261014-015','priorId':old['id'] if old else None})
assert len(rows)==len({r['id'] for r in rows})
groups=collections.defaultdict(list)
for r in rows:groups[key(r)].append(r['id'])
errors=[]
for e in raw.get('errors',[]):
 row={k:e[k] for k in ['code','type','path','spans','rule_id'] if k in e};row['sourceSha256']=hashes.get(e.get('path'));errors.append(row)
scanned=set(raw.get('paths',{}).get('scanned',[]));summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':raw.get('version'),'rawSha256':hashlib.sha256(rawpath.read_bytes()).hexdigest(),'targets':len(hashes),'selected':len(scanned),'missingTargets':sorted(set(hashes)-scanned),'rawSignals':len(rows),'uniqueRuleExactRanges':len(groups),'duplicateOccurrences':len(rows)-len(groups),'retainedHistoricalIds':sum(r['priorId'] is not None for r in rows),'newIds':[r['id'] for r in rows if r['priorId'] is None],'staleFiles':sorted({r['path'] for r in rows if r['staleForCurrentSource']}),'severities':dict(collections.Counter(r['severity'] for r in rows)),'categories':dict(collections.Counter(r['category'] for r in rows)),'errors':errors,'limits':'Exact range includes columns. Duplicate aliases preserved. Normalized pinned-rule directory prefix only; no finding discarded. Selected does not imply fully parsed.'}
outputs={'sast-findings-final.jsonl':''.join(json.dumps(r)+'\n' for r in rows),'sast-summary-final.json':json.dumps(summary,indent=2),'sast-location-groups-final.json':json.dumps([{'ruleId':k[0],'path':k[1],'startLine':k[2],'startCol':k[3],'endLine':k[4],'endCol':k[5],'canonicalId':v[0],'allOccurrenceIds':v} for k,v in groups.items()],indent=2)}
for name in outputs:assert not (B/name).exists(),name
for name,value in outputs.items():
 with (B/name).open('x') as f:f.write(value)
print(json.dumps({k:summary[k] for k in ['targets','selected','rawSignals','uniqueRuleExactRanges','duplicateOccurrences','retainedHistoricalIds','newIds','staleFiles']},indent=2))

from pathlib import Path
import json,collections,hashlib,subprocess,difflib,datetime,re
B=Path(__file__).resolve().parent;ROOT=B.parents[3];P=B.parent/'investigation-2026-10-14'
raw=Path('/home/user/audit-resumption/.cache/semgrep-closure-final-result.json');x=json.loads(raw.read_text());manifest=json.loads((B/'semgrep-targets-final.json').read_text());targets={r['path']:r['sha256'] for r in manifest['targets']}
old=[json.loads(l) for l in (P/'sast-findings-final.jsonl').read_text().splitlines()]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
line_maps={}
for p in {r['path'] for r in old}:
 prior=subprocess.check_output(['git','show','HEAD:'+p],cwd=ROOT).decode().splitlines();current=(ROOT/p).read_text().splitlines()
 sm=difflib.SequenceMatcher(a=prior,b=current,autojunk=False);line_maps[p]={a+1:b+1 for a0,b0,n in sm.get_matching_blocks() for a,b in zip(range(a0,a0+n),range(b0,b0+n))}
def key(rule,p,s,e):return (rule,p,s['line'],s['col'],e['line'],e['col'])
expected=collections.defaultdict(collections.deque);unmappable=[]
for r in old:
 m=line_maps[r['path']]
 if r['start']['line'] not in m or r['end']['line'] not in m:unmappable.append(r['id']);continue
 s=dict(r['start'],line=m[r['start']['line']]);e=dict(r['end'],line=m[r['end']['line']]);expected[key(r['ruleId'],r['path'],s,e)].append(r)
assert not unmappable,unmappable
rows=[];new=[]
for r in x['results']:
 rule=re.sub(r'^.*?semgrep-rules-[^.]+\.', '',r['check_id']);p=r['path'];k=key(rule,p,r['start'],r['end'])
 prev=expected[k].popleft() if expected[k] else None
 rid=prev['id'] if prev else 'SAST-20261014-'+str(866+len(new)).zfill(4)
 if not prev:new.append(rid)
 assert sha(ROOT/p)==targets[p],p
 rows.append({'id':rid,'ruleId':rule,'path':p,'start':r['start'],'end':r['end'],'sourceSha256':targets[p],'severity':r['extra']['severity'],'category':r['extra'].get('metadata',{}).get('category','unknown'),'status':'EN ATTENTE DE REVUE','issueId':'FUP-20261014-015','priorId':prev['id'] if prev else None,'locationReconciliation':'Exact rule and full range after matching unchanged source lines, FIFO for duplicate occurrences.'})
missing=[r['id'] for q in expected.values() for r in q];assert not missing,missing
assert len(rows)==len({r['id'] for r in rows})==865
for name,data in [('sast-findings-final.jsonl',rows)]: (B/name).write_text(''.join(json.dumps(r)+'\n' for r in data))
g=collections.defaultdict(list)
for r in rows:g[key(r['ruleId'],r['path'],r['start'],r['end'])].append(r['id'])
groups=[{'ruleId':k[0],'path':k[1],'start':{'line':k[2],'col':k[3]},'end':{'line':k[4],'col':k[5]},'allOccurrenceIds':ids,'canonicalId':ids[0]} for k,ids in sorted(g.items())]
(B/'sast-location-groups-final.json').write_text(json.dumps(groups,indent=2)+'\n')
errors=[{'code':e['code'],'path':e.get('path'),'type':e['type'] if isinstance(e['type'],str) else e['type'][0]} for e in x['errors']]
summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':x['version'],'rawSha256':sha(raw),'targets':len(targets),'selected':len(x['paths']['scanned']),'rawSignals':len(rows),'uniqueRuleExactRanges':len(g),'duplicateOccurrences':len(rows)-len(g),'retainedHistoricalIds':len(rows)-len(new),'newIds':new,'missingHistoricalIds':missing,'severities':dict(collections.Counter(r['severity'] for r in rows)),'categories':dict(collections.Counter(r['category'] for r in rows)),'errors':errors,'limits':'No finding discarded. Exact column ranges are not merged merely because they overlap. Zero parser errors under this pinned scanner/config is not exhaustive security or all-language coverage.'}
(B/'sast-summary-final.json').write_text(json.dumps(summary,indent=2)+'\n')
# Historical triage remains valid only with a matching source hash and an existing signal.
byid={r['id']:r for r in rows};triage=[]
for line in (P/'sast-triage-current.jsonl').read_text().splitlines():
 r=json.loads(line);assert r['sourceSha256']==byid[r['id']]['sourceSha256'];r['historicalProof']={k:r[k] for k in ['proof'] if k in r};r['proof']=['../investigation-2026-10-14/sast-triage-current.jsonl','sast-findings-final.jsonl'];r['revalidatedAt']=summary['at'];triage.append(r)
for suffix in ['0788','0789','0790','0791','0792','0793','0794','0795','0853','0854']:
 r=byid['SAST-20261014-'+suffix];lua=suffix in ['0853','0854'];triage.append({'id':r['id'],'ruleId':r['ruleId'],'path':r['path'],'start':r['start'],'end':r['end'],'sourceSha256':r['sourceSha256'],'status':'VALIDÉ' if lua else 'PARTIELLEMENT VALIDÉ','classification':'INTENTIONAL_LUA_TABLE_LITERAL' if lua else 'DB_SCOPED_FILENAME_REQUIRES_FILESYSTEM_BOUNDARY_REVIEW','reason':'The {c, t} literal is Lua syntax in an intentionally static script passed as EVAL with separate KEYS/ARGV; no JS interpolation is missing. Two instances and five real isolated Redis tests pass.' if lua else 'Entire backup service and owner routes read: garage-scoped record lookup, generated filename for creation. Read paths trust DB filename; containment, collision/symlink behavior and storage failure consistency are not proved. Not classified as a confirmed traversal or a blanket false positive.','proof':['evidence/redis-real.json','review-ledger-final.jsonl'] if lua else ['manual-review-notes-final.json','review-ledger-final.jsonl'],'limits':'Finding-specific source decision, no rule disabled; not runtime/production certification.'})
assert len(triage)==len({r['id'] for r in triage})==27
(B/'sast-triage-final.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in triage));print(json.dumps(summary|{'triages':len(triage),'triageStatuses':dict(collections.Counter(r['status'] for r in triage)),'pendingRawSignals':len(rows)-len(triage)},indent=2))

from run import *
import collections,re
C=B.parent/'closure-2026-10-14'
x=json.loads((B/'evidence/semgrep-settled-raw.json').read_text());manifest=json.loads((B/'semgrep-targets-settled.json').read_text());targets={r['path']:r['sha256'] for r in manifest['targets']}
assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in targets.items())
def key(rule,p,s,e):return (rule,p,s['line'],s['col'],e['line'],e['col'])
old=list(map(json.loads,(C/'sast-findings-final.jsonl').read_text().splitlines()));queues=collections.defaultdict(collections.deque)
for r in old:queues[key(r['ruleId'],r['path'],r['start'],r['end'])].append(r)
rows=[]
for r in x['results']:
 rule=re.sub(r'^.*?semgrep-rules-[^.]+\.', '',r['check_id']);k=key(rule,r['path'],r['start'],r['end']);assert queues[k],k
 prev=queues[k].popleft();rows.append({**prev,'start':r['start'],'end':r['end'],'sourceSha256':targets[r['path']],'observedAt':now(),'priorRecord':'../closure-2026-10-14/sast-findings-final.jsonl#'+prev['id']})
assert not any(queues.values());assert len(rows)==len({r['id'] for r in rows})
(B/'sast-findings-current.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
triage={r['id']:r for r in map(json.loads,(B/'sast-triage-current.jsonl').read_text().splitlines())};assert len(triage)==59
byid={r['id']:r for r in rows}
for id,d in triage.items():assert byid[id]['sourceSha256']==d['sourceSha256']
g=collections.defaultdict(list)
for r in rows:g[key(r['ruleId'],r['path'],r['start'],r['end'])].append(r['id'])
reg=[]
for k,ids in sorted(g.items()):
 statuses=[triage[id]['status'] if id in triage else 'EN ATTENTE DE REVUE' for id in ids]
 status='EN ATTENTE DE REVUE' if 'EN ATTENTE DE REVUE' in statuses else ('PARTIELLEMENT VALIDÉ' if 'PARTIELLEMENT VALIDÉ' in statuses else 'VALIDÉ')
 reg.append({'ruleId':k[0],'path':k[1],'start':{'line':k[2],'col':k[3]},'end':{'line':k[4],'col':k[5]},'allOccurrenceIds':ids,'canonicalId':ids[0],'status':status,'occurrences':[{'id':id,'status':s,'decision':'sast-triage-current.jsonl#'+id if id in triage else None} for id,s in zip(ids,statuses)]})
(B/'sast-review-register.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in reg))
summary={'at':now(),'version':x['version'],'rawSha256':hashlib.sha256((B/'evidence/semgrep-settled-raw.json').read_bytes()).hexdigest(),'targets':len(targets),'selected':len(x['paths']['scanned']),'signals':len(rows),'groups':len(reg),'duplicates':len(rows)-len(reg),'errors':x['errors'],'retainedHistoricalIds':len(old),'decisions':len(triage),'decisionStatuses':dict(collections.Counter(r['status'] for r in triage.values())),'reviewedGroups':sum(r['status']!='EN ATTENTE DE REVUE' for r in reg),'groupStatuses':dict(collections.Counter(r['status'] for r in reg)),'pendingOccurrences':len(rows)-len(triage),'limits':'First scan and first typecheck crossed a policy-source edit; settled scan/typecheck supersede them. Same rules/exclusions; raw capture preserved, no signals removed, overlaps not merged. Each alias has its own decision. Not vulnerability-free.'}
(B/'sast-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))

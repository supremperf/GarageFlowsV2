from pathlib import Path
import json,collections,datetime
B=Path(__file__).resolve().parent
findings={r['id']:r for r in map(json.loads,(B/'sast-findings-final.jsonl').read_text().splitlines())};triage={r['id']:r for r in map(json.loads,(B/'sast-triage-final.jsonl').read_text().splitlines())};groups=json.loads((B/'sast-location-groups-final.json').read_text());rows=[]
for g in groups:
 ids=g['allOccurrenceIds'];f=findings[ids[0]];states={rid:triage[rid]['status'] if rid in triage else 'EN ATTENTE DE REVUE' for rid in ids};values=set(states.values())
 status='EN ATTENTE DE REVUE' if 'EN ATTENTE DE REVUE' in values else ('PARTIELLEMENT VALIDÉ' if 'PARTIELLEMENT VALIDÉ' in values else 'VALIDÉ')
 rows.append({**g,'sourceSha256':f['sourceSha256'],'category':f['category'],'severity':f['severity'],'status':status,'occurrenceStatuses':states,'decisions':[{k:r[k] for k in ['id','classification','reason','assessment','remaining','proof','limits'] if k in r} for rid in ids if (r:=triage.get(rid))],'untriagedOccurrenceIds':[rid for rid in ids if rid not in triage],'limits':'Exact-range group only; overlaps remain distinct. No alias inherits a decision without its own recorded occurrence decision. Source-level VALIDÉ is not a functional/security certificate.'})
assert len(rows)==845
(B/'sast-review-register.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows));summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'groups':len(rows),'groupStatuses':dict(collections.Counter(r['status'] for r in rows)),'rawOccurrences':sum(len(r['allOccurrenceIds']) for r in rows),'triagedOccurrences':len(triage),'untriagedOccurrences':len(findings)-len(triage),'limits':'Raw finding status records collection state; this register overlays authoritative per-occurrence decisions without dropping aliases or claiming vulnerability counts.'}
(B/'sast-review-progress.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))

from pathlib import Path
import json,collections,re,datetime
B=Path(__file__).resolve().parent;ROOT=B.parents[3];P=B.parent/'investigation-2026-10-14';x=json.loads((B/'evidence/vitest-candidate.json').read_text())
previous={(r['file'],r['name']):r for r in map(json.loads,(P/'tests-skipped.jsonl').read_text().splitlines())};rows=[];skips=[];fails=[]
for fi,f in enumerate(x['testResults']):
 p=str(Path(f['name']).relative_to(ROOT))
 for ti,t in enumerate(f['assertionResults']):
  r={'file':p,'name':t['fullName'],'runnerStatus':t['status'],'evidence':f'evidence/vitest-candidate.json#/testResults/{fi}/assertionResults/{ti}'}
  if t['status'] in ['skipped','pending','todo']:
   old=previous[(p,t['fullName'])];r.update({k:old[k] for k in ['category','issue','cause','prerequisite','criticality'] if k in old});r['status']='BLOQUÉ' if old['status']=='BLOQUÉ' else 'EN ATTENTE DE REVUE';skips.append(r)
  elif t['status']=='failed':
   r['status']='ÉCHOUÉ';msg='\n'.join(t['failureMessages']);r['officialDownloadUrls']=sorted(set(re.findall(r'https://binaries\.prisma\.sh/[^\s\x1b<>\"\']+',msg)));r['preTLSDisconnect']='Client network socket disconnected before secure TLS connection was established' in msg;r['cause']='Real Prisma CLI db push cannot download official engine/checksum; no successful SQLite schema preparation observed.' if r['preTLSDisconnect'] else 'Unknown; inspect referenced failureMessages';fails.append(r)
  else:r['status']='VALIDÉ'
  rows.append(r)
for name,data in [('tests-all.jsonl',rows),('tests-skipped.jsonl',skips),('tests-failed.jsonl',fails)]: (B/name).write_text(''.join(json.dumps(r)+'\n' for r in data))
log=(B/'evidence/vitest-candidate.log').read_text();plain=re.sub(r'\x1b\[[0-9;]*m','',log);sections=plain.split('Unhandled Rejection')[1:];globals=[]
for i,s in enumerate(sections):
 s=s[:9000];files=sorted(set(re.findall(r'src/[A-Za-z0-9_@/().\[\]-]+\.test\.ts',s)));globals.append({'index':i+1,'errorClass':'PrismaClientInitializationError' if 'PrismaClientInitializationError' in s else 'UNKNOWN','queryEngineNotLocated':'Prisma Client could not locate' in s,'testFileMentions':files,'status':'BLOQUÉ','proof':'evidence/vitest-candidate.log#Unhandled-Rejection-'+str(i+1),'limits':'Immediate failure cause only; no native-runtime repair or blanket dismissal of unhandled errors.'})
(B/'tests-global-errors.json').write_text(json.dumps(globals,indent=2)+'\n')
counts=collections.Counter(r['runnerStatus'] for r in rows);summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'total':len(rows),'passed':counts['passed'],'failed':counts['failed'],'skipped':len(skips),'skipCategories':dict(collections.Counter(r['category'] for r in skips)),'unhandledErrors':len(globals),'fileCount':len(x['testResults']),'failedFiles':sum(f['status']=='failed' for f in x['testResults']),'exitCode':1,'sourceCommandId':'vitest-candidate','proof':'evidence/vitest-candidate.json','globalProof':'evidence/vitest-candidate.log','limits':'Authoritative dual-reporter full run on final uncommitted candidate. Three earlier runs preserved separately, not summed. Separate Redis 5/5 does not rewrite the five skips in this full run.'}
assert len(rows)==3841 and counts['passed']==2994 and counts['failed']==3 and len(skips)==844 and len(globals)==4,summary
assert all(r['preTLSDisconnect'] for r in fails)
(B/'tests-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))

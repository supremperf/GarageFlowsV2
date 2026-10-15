from run import *
import collections,re
C=B.parent/'closure-2026-10-14'
previous={(r['file'],r['name']):r for r in map(json.loads,(C/'tests-skipped.jsonl').read_text().splitlines())}
results=[]
for name in ['full-suite','full-suite-provisioned']:
 x=json.loads((B/f'evidence/{name}.json').read_text());rows=[];skips=[];fails=[]
 for fi,f in enumerate(x['testResults']):
  p=str(pathlib.Path(f['name']).relative_to(ROOT))
  for ti,t in enumerate(f['assertionResults']):
   r={'file':p,'name':t['fullName'],'runnerStatus':t['status'],'evidence':f'evidence/{name}.json#/testResults/{fi}/assertionResults/{ti}'}
   if t['status'] in ['skipped','pending','todo']:
    old=previous.get((p,t['fullName']))
    if old:r.update({k:old[k] for k in ['category','issue','cause','prerequisite','criticality'] if k in old})
    else:
     assert p=='src/lib/license/__tests__/license-keygen-e2e.test.ts' and 'cryptography indisponible' in f['message']
     r.update(category='SETUP_FAILURE_PYTHON_CRYPTOGRAPHY_ABSENT',issue='FUP-20261014-012',cause='beforeAll failed because default /usr/bin/python3 lacks cryptography. Not intentionally skipped.',prerequisite='Use verified installed isolated Python cryptography environment; replay separately.')
    r['status']='BLOQUÉ';skips.append(r)
   elif t['status']=='failed':
    msg='\n'.join(t['failureMessages']);r.update(status='ÉCHOUÉ',preTLSDisconnect='Client network socket disconnected before secure TLS connection was established' in msg,officialDownloadUrls=sorted(set(re.findall(r'https://binaries\.prisma\.sh/[^\s\x1b<>\"\']+',msg))),trace=t['failureMessages']);fails.append(r)
   else:r['status']='VALIDÉ'
   rows.append(r)
 for suffix,data in [('all',rows),('skipped',skips),('failed',fails)]: (B/f'{name}-{suffix}.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in data))
 plain=re.sub(r'\x1b\[[0-9;]*m','',(B/f'evidence/{name}.log').read_text());sections=plain.split('Unhandled Rejection')[1:];errors=[]
 for i,s in enumerate(sections):
  s=s.split('JSON report written')[0];origin=re.search(r'This error originated in "([^"\n]+)"',s)
  errors.append({'index':i+1,'status':'BLOQUÉ','processStatus':'ÉCHOUÉ','originatingContext':origin.group(1) if origin else None,'nativeEngineMissing':'Prisma Client could not locate the Query Engine' in s,'proof':f'evidence/{name}.log#Unhandled-Rejection-{i+1}','limits':'Vitest originating file is context, not proof exact throwing location; native loader stack reproduced in isolated run.'})
 (B/f'{name}-global-errors.json').write_text(json.dumps(errors,indent=2)+'\n')
 counts=collections.Counter(r['runnerStatus'] for r in rows);receipt=json.loads((B/f'evidence/{name}.command.json').read_text())
 summary={'commandId':name,'startedAt':receipt['startedAt'],'finishedAt':receipt['finishedAt'],'head':receipt['head'],'sourceFingerprint':receipt['sourceFingerprint'],'total':len(rows),'passed':counts['passed'],'failed':counts['failed'],'skipped':len(skips),'globalErrors':len(errors),'files':len(x['testResults']),'failedFiles':sum(f['status']=='failed' for f in x['testResults']),'skipCategories':dict(collections.Counter(r['category'] for r in skips)),'exitCode':receipt['exitCode'],'status':'ÉCHOUÉ','limits':'Independent execution, not summed with target reruns or other full suites. Redis absent in full run; separate real Redis success does not change its skips. JSON success=true in an isolated suite does not override process exit1/unhandled errors.'}
 assert len(rows)==x['numTotalTests'] and summary['passed']==x['numPassedTests'] and summary['failed']==x['numFailedTests']
 assert all(r['preTLSDisconnect'] for r in fails)
 (B/f'{name}-summary.json').write_text(json.dumps(summary,indent=2)+'\n');results.append(summary)
(B/'tests-comparison.json').write_text(json.dumps({'historical':'../closure-2026-10-14/tests-summary.json','runs':results,'environmentCorrection':'Explicit PATH includes pre-existing /home/user/audit-resumption/.venv/bin Python with cryptography 50.0.2. No tests/expectations changed; first run seven blocked keygen cases preserved. Real ephemeral-key signing, not official production issuer validation.'},indent=2)+'\n');print(json.dumps(results,indent=2))

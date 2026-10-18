"""Current per-file source review and per-case tests; never overwrite prior ledgers."""
import pathlib,json,hashlib,subprocess,collections,datetime,re
B=pathlib.Path(__file__).resolve().parent;ROOT=B.parents[3]
prior={r['path']:r for r in map(json.loads,(B.parent/'review-ledger.jsonl').read_text().splitlines())}
notes={
 'package.json':('Prior full reading retained for unchanged content; complete changed script addition reread; no dependency/build/budget change.',['dependencies','ci']),
 '.github/workflows/ci.yml':('Prior full source review plus all current installer/reporting/mandatory-guard hunks reviewed. Exact download/checksum/exit propagation, no privilege escalation or optional scan; actual runs distinguished. Unavailable staging/Windows and E2E failures remain open.',['ci','supply-chain','secrets']),
 'scripts/gitleaks-ci.cjs':('Entire collector and current inventory addition read: whitelist/no Secret/Match/child output, private temporary report, cleanup only owned directory, workflow escaping, fail-closed statuses/null handling. Unit proof14 cases; real scanner separately attested by CI.',['secrets','filesystem','ci','errors']),
 'tests/gitleaks-ci.test.cjs':('All unit fake-report/spawn cases read; synthetic random sentinel, no real credential. Tests do NOT substitute for official scanner.',['tests','privacy','ci']),
 'tests/secret-scan-policy.test.cjs':('Entire policy module read: default rules/source non-exclusion plus exactly3 immutable public-header fingerprints, full file hashes and header-kind guards. Mandatory in secrets and dependency job.',['tests','privacy','ci']),
 '.gitleaksignore':('Three exact file/rule/line public OAuth identifier findings only; mandatory hash/header guard prevents silently muting changed evidence. No broad path/regex exemption.',['secrets','policy']),
 'electron/secret.js':('Full load/create/env priority/weak-secret checks read. Random installation keys, owned temporary wx+fsync, restrictive permissions, no key output. Concurrent first-use rename-overwrite and caller single-instance ordering still need dedicated analysis; no production keys touched.',['secrets','filesystem','concurrency']),
 'electron/semver.js':('Entire parser/prerelease comparator read. parseInt accepts noncanonical numeric suffixes; callers must validate signed release metadata. No new claim of strict SemVer validation or updater-runtime closure.',['input','updates']),
 'electron/startup-gate.js':('Entire terminal-block/lid/re-activation/purge logic read; missing identity fails closed, unrelated known lid can clear block. Pure tests cannot attest issuer/native caller ordering.',['authorization','license']),
 'electron/user-data-path.js':('Entire historical path pin/error/result verification read; no implicit relocation/reset. Windows casing/real Electron behavior not attested.',['filesystem','data','errors']),
 'electron/sauvegarde-en-souffrance.js':('Entire age/silence/no-backup decision and formatting read. Rollback age clamp intentional; malformed/future metadata and native clock lifecycle remain caller-boundary risks.',['data','time','errors']),
 'e2e/inspection-contrast.spec.ts':('All DOM/evaluation/callers and teardown/assertions read. HTML interpolation uses local fixed SAMPLE/INSP_INPUT, never external customer input; scoped XSS signals not production vulnerabilities. This is not a rendering test pass: latest E2E job fails.',['tests','renderer','input']),
}
ignored={'docs/audit/inventory.jsonl','docs/audit/inventory-current.jsonl','docs/audit/module-map.jsonl','docs/audit/scope.json'}
excluded=['docs/audit/followup-2026-10-14/','docs/audit/resumption-2026-10-14/']
names=sorted(set(subprocess.check_output(['git','ls-files','-c','-o','--exclude-standard','-z'],cwd=ROOT).decode().split('\0'))- {''})
rows=[]
for name in names:
 if name in ignored or any(name.startswith(p) for p in excluded):continue
 p=ROOT/name
 if not p.is_file() and not p.is_symlink():continue
 data=p.read_bytes();h=hashlib.sha256(data).hexdigest();lines=len(data.splitlines());old=prior.get(name)
 manual=json.loads(json.dumps(old['manualReview'])) if old and old['sha256']==h else {'status':'EN ATTENTE DE REVUE','fullFileRead':False,'ranges':[],'notes':'New/changed source: prior review not inherited.'}
 if name in notes:
  note,categories=notes[name];manual={'status':'VALIDÉ','fullFileRead':True,'ranges':[[1,lines]],'categories':categories,'notes':note,'meaning':'Full semantic source review, NOT full functional/security closure.'}
 if name in ['ENVIRONMENT-VARIABLES.md','scripts/garageflow-env-manifest.json']:
  changed=[i+1 for i,s in enumerate(data.decode().splitlines()) if 'GITHUB_SHA' in s]
  manual={'status':'PARTIELLEMENT VALIDÉ','fullFileRead':False,'ranges':[[i,i] for i in changed],'notes':'Precisely reviewed platform-provided SHA declaration and generated documentation; all other variables not fully rereviewed.'}
 if name=='tests/config.test.cjs':
  manual={'status':'PARTIELLEMENT VALIDÉ','fullFileRead':False,'ranges':[[60,109]],'notes':'Negative configuration cases read and single placeholder concatenation checked for exact runtime equality. All49 config tests pass; remainder not newly claimed fully read.'}
 rows.append({'path':name,'sha256':h,'bytes':len(data),'priority':old.get('priority','P1') if old else 'P0','manualReview':manual,'stages':{'inventoried':True,'read':bool(manual['ranges']),'analyzed':manual['fullFileRead'],'functionallyReviewed':False,'closed':False},'testsAndEvidence':['evidence/manual-batch-regression.json','evidence/corrections-regression.json','evidence/bounded-finding-policy.log','REPORT.md'],'limitations':'Per-file semantic review is not native/runtime/security certification. Outstanding caller boundaries and external prerequisites remain.'})
assert len(rows)==len({r['path'] for r in rows})
(B/'review-ledger.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'total':len(rows),'manualReview':dict(collections.Counter(r['manualReview']['status'] for r in rows)),'mutuallyExclusive':True,'newFullReviews':list(notes),'exclusions':{'documentedGeneratedEvidenceDirectories':excluded,'automaticInventories':sorted(ignored),'gitIgnored':'Private configuration, installed dependencies and generated outputs remain ignored; not a product source exemption.'},'nextBatch':[{'path':r['path'],'sha256':r['sha256'],'priority':r['priority']} for r in sorted(rows,key=lambda r:(r['priority'],r['path'])) if not r['manualReview']['fullFileRead']][:12],'limits':'Not exhaustive; no counts of reading/AST/hash presented as functionality.'}
(B/'review-progress.json').write_text(json.dumps(summary,indent=2))
oldskips={(r['file'],r['name']):r for r in map(json.loads,(B.parent/'tests-skipped.jsonl').read_text().splitlines())};x=json.loads((B/'evidence/vitest-complete.json').read_text());allcases=[];skips=[];failures=[]
for fi,f in enumerate(x['testResults']):
 file=str(pathlib.Path(f['name']).relative_to(ROOT))
 for ti,t in enumerate(f['assertionResults']):
  name=t['fullName'];row={'file':file,'name':name,'runnerStatus':t['status'],'evidence':f'evidence/vitest-complete.json#/testResults/{fi}/assertionResults/{ti}'}
  if t['status'] in ['pending','skipped','todo']:
   prev=oldskips.get((file,name));assert prev,(file,name)
   row.update({k:prev[k] for k in ['category','issue','cause','prerequisite','criticality'] if k in prev});row['status']='BLOQUÉ' if prev['status']=='BLOQUÉ' else 'EN ATTENTE DE REVUE';skips.append(row)
  elif t['status']=='failed':row['status']='ÉCHOUÉ';failures.append(row)
  else:row['status']='VALIDÉ'
  allcases.append(row)
assert len(allcases)==3829 and len(skips)==844 and len(failures)==3
for filename,data in [('tests-all.jsonl',allcases),('tests-skipped.jsonl',skips),('tests-failed.jsonl',failures)]:
 (B/filename).write_text(''.join(json.dumps(r)+'\n' for r in data))
counts=collections.Counter(r['category'] for r in skips)
(B/'tests-summary.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'total':len(allcases),'passed':sum(r['runnerStatus']=='passed' for r in allcases),'failed':len(failures),'skipped':len(skips),'skipCategories':dict(counts),'unhandledErrors':4,'unhandledProof':'evidence/vitest-complete.log (four Unhandled Rejection sections)','failedFiles':sum(f['status']=='failed' for f in x['testResults']),'fileCount':len(x['testResults']),'limits':'Separate execution, no focused-run addition or inherited Redis success. Vitest numFailedTestSuites counts nested suites, not files.'},indent=2))
print(json.dumps({'review':summary['manualReview'],'totalFiles':len(rows),'tests':len(allcases),'skips':dict(counts)},indent=2))

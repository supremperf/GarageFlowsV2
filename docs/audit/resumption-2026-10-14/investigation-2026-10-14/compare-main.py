"""Read-only manifests, not a Dependabot alert export or installation of main."""
import pathlib,json,subprocess,hashlib,datetime
B=pathlib.Path(__file__).resolve().parent
ROOT=B.parents[3]
sha=subprocess.check_output(['git','rev-parse','FETCH_HEAD'],text=True).strip()
raw={p:subprocess.check_output(['git','show',sha+':'+p]) for p in ['package.json','package-lock.json']}
local=json.loads((ROOT/'package-lock.json').read_text());main=json.loads(raw['package-lock.json']);changed=[]
for name in sorted(set(main['packages'])|set(local['packages'])):
 if name=='':continue
 a=main['packages'].get(name,{});b=local['packages'].get(name,{})
 if a.get('version')!=b.get('version') or a.get('resolved')!=b.get('resolved'):
  # Never emit registry URLs, integrity content or unrelated package metadata.
  changed.append({'path':name,'mainVersion':a.get('version'),'auditVersion':b.get('version'),'directMain':name.removeprefix('node_modules/') in {**main['packages'][''].get('dependencies',{}),**main['packages'][''].get('devDependencies',{})},'devMain':a.get('dev',False),'optionalMain':a.get('optional',False)})
manifest=json.loads(raw['package.json']);deps={}
for kind in ['dependencies','devDependencies','optionalDependencies']:
 for name in sorted(set(manifest.get(kind,{}))|set(json.loads((ROOT/'package.json').read_text()).get(kind,{}))):
  a=manifest.get(kind,{}).get(name);b=json.loads((ROOT/'package.json').read_text()).get(kind,{}).get(name)
  if a!=b:deps[kind+':'+name]={'main':a,'audit':b}
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mainCommit':sha,'auditCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'manifestHashes':{p:hashlib.sha256(v).hexdigest() for p,v in raw.items()},'changedLockEntries':changed,'changedDirectDeclarations':deps,'limits':'Lockfile resolution only, not actual installed main versions and not authenticated Dependabot alerts; no main checkout/merge/installation.'}
(B/'main-lock-comparison.json').write_text(json.dumps(out,indent=2))
# Disposable, separate manifest-only snapshot for registry audit; no scripts run.
snapshot=pathlib.Path('/home/user/audit-resumption/main-manifest-snapshot-'+sha[:12]);snapshot.mkdir(exist_ok=True)
for p,data in raw.items():
 target=snapshot/p
 if target.exists():assert target.read_bytes()==data
 else:target.write_bytes(data)
print(json.dumps({'mainCommit':sha,'changedLockEntries':len(changed),'changedDirectDeclarations':len(deps),'snapshot':str(snapshot),'limitations':out['limits']},indent=2))

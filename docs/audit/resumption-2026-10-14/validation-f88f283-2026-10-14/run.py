import os,sys,json,subprocess,datetime,hashlib,pathlib,signal
ROOT=pathlib.Path(__file__).resolve().parents[4]; B=pathlib.Path(__file__).resolve().parent
ENV=dict(os.environ,PATH='/home/user/audit-followup/tools/node_modules/.bin:'+os.environ['PATH'],NODE_USE_SYSTEM_CA='1')
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def identity():
 paths=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
 rows=[{'path':p,'sha256':hashlib.sha256((ROOT/p).read_bytes()).hexdigest()} for p in paths if p and not p.startswith('docs/audit/') and (ROOT/p).is_file()]
 return {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),'sourceFingerprint':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),'trackedNonAuditFiles':len(rows)}
def run(id,argv,timeout=600,env=None):
 log=B/'evidence'/f'{id}.log'; receipt=B/'evidence'/f'{id}.command.json'
 if log.exists() or receipt.exists(): raise RuntimeError('Refusing overwrite '+id)
 r={'id':id,'startedAt':now(),'timezone':'Europe/Paris','cwd':str(ROOT),'argv':argv,'timeoutSeconds':timeout,**identity(),'environmentOverrides':{'PATH':'pinned npm 11.16.0 first','NODE_USE_SYSTEM_CA':'1',**(env or {})},'proof':str(log.relative_to(B))}
 with log.open('xb') as f:
  p=subprocess.Popen(argv,cwd=ROOT,env={**ENV,**(env or {})},stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try: r['exitCode']=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM);p.wait();r.update(exitCode=p.returncode,timedOut=True)
 r.update(finishedAt=now(),afterIdentity=identity(),logSha256=hashlib.sha256(log.read_bytes()).hexdigest())
 receipt.write_text(json.dumps(r,indent=2)+'\n'); print(id,r['exitCode'],flush=True);return r
if __name__=='__main__': run(sys.argv[1],sys.argv[2:])

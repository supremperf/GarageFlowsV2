import subprocess,json,pathlib,datetime,re,hashlib,os
B=pathlib.Path(__file__).resolve().parent
cache=pathlib.Path('/home/user/audit-resumption/.cache/closure-2026-10-14');cache.mkdir(parents=True,exist_ok=True);os.chmod(cache,0o700)
def get(args):
 p=subprocess.run(['gh',*args],capture_output=True,text=True,timeout=100)
 return p
runs=[]
for rid in ['38591143098','38589332331']:
 p=get(['run','view',rid,'--json','status,conclusion,jobs,url,headSha,createdAt,updatedAt'])
 if p.returncode:raise RuntimeError('Metadata request failed: '+str(p.returncode))
 x=json.loads(p.stdout);x['runId']=rid;x['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();runs.append(x)
(B/'ci-runs.json').write_text(json.dumps(runs,indent=2)+'\n')
receipts=[]
# Download raw data only into restricted, untracked cache. Publish no raw logs.
for rid,jid in [('38591143098','115948268697'),('38591143098','115948268736'),('38589332331','115939685204'),('38591143098','115946042324')]:
 args=['run','view',rid,'--job',jid,'--log-failed'] if rid=='38589332331' or jid in ['115948268697','115948268736'] else ['run','view',rid,'--job',jid,'--log']
 p=get(args)
 raw=(p.stdout+'\n'+p.stderr).encode();dest=cache/(jid+'.log');dest.write_bytes(raw);os.chmod(dest,0o600)
 # Only known, value-free diagnostic categories: arbitrary error lines may contain secrets.
 markers=[]
 patterns=[r'Missing required staging input: (BASE_URL|E2E_EMAIL|E2E_PASSWORD|E2E_LICENSE)',r'Non-production environment approval required',r'Refused staging target: HTTPS/non-production host without URL credentials required',r'JavaScript heap out of memory',r'ERR_ELECTRON_BUILDER_CANNOT_EXECUTE',r'certificate has expired',r'unable to verify the first certificate',r'UNABLE_TO_VERIFY_LEAF_SIGNATURE',r'ECONNRESET',r'ETIMEDOUT',r'ENOTFOUND',r'HTTP 403',r'403 Forbidden',r'unexpected EOF',r'\bEOF\b',r'Process completed with exit code [0-9]+',r'Error: ENOENT',r'Failed to compile',r'Type error:',r'No space left on device',r'error TS[0-9]+',r'cannot find module',r'Cannot find module']
 text=raw.decode(errors='replace')
 for pat in patterns:
  for m in re.finditer(pat,text):
   if m.group() not in markers:markers.append(m.group())
 receipts.append({'runId':rid,'jobId':jid,'argv':['gh',*args],'exitCode':p.returncode,'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'rawPublished':False,'safeDiagnosticMarkers':markers,'limitation':'Only allowlisted value-free diagnostic markers exported; no arbitrary log context or signed URLs. Empty markers do not establish absence of test failures.'})
(B/'ci-log-access.json').write_text(json.dumps(receipts,indent=2)+'\n')
# Check-run annotations contain arbitrary text: only publish locations, severity and safe marker types.
annotations=[]
for rid in runs:
 for j in rid['jobs']:
  if j['conclusion']!='failure' and 'Gitleaks' not in j['name']:continue
  p=get(['api',f'repos/supremperf/GarageFlowsV2/check-runs/{j["databaseId"]}/annotations?per_page=100','--paginate'])
  row={'runId':rid['runId'],'headSha':rid['headSha'],'jobId':j['databaseId'],'jobName':j['name'],'exitCode':p.returncode,'annotations':[]}
  if p.returncode==0:
   decoder=json.JSONDecoder();text=p.stdout.strip()
   while text:
    data,idx=decoder.raw_decode(text);text=text[idx:].lstrip()
    for a in data:
     msg=a.get('message','');markers=[]
     for pat in [r'findings=\d+',r'scannerExit=\d+',r'Process completed with exit code \d+',r'Missing required staging input: (BASE_URL|E2E_EMAIL|E2E_PASSWORD|E2E_LICENSE)',r'Non-production environment approval required']:
      markers.extend(m.group() for m in re.finditer(pat,msg))
     row['annotations'].append({k:a.get(k) for k in ['path','start_line','end_line','annotation_level']}|{'safeMarkers':markers})
  annotations.append(row)
(B/'ci-annotations.json').write_text(json.dumps(annotations,indent=2)+'\n')
print(json.dumps({'runs':[{k:r[k] for k in ['runId','headSha','status','conclusion']} for r in runs],'logAccess':receipts,'annotationRequests':len(annotations)},indent=2))

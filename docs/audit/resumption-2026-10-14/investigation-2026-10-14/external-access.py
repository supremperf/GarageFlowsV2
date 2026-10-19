"""Read-only GitHub evidence; project secret values and signed URL queries never persisted."""
import subprocess,json,pathlib,re,datetime,hashlib
B=pathlib.Path(__file__).resolve().parent
results=[]
for label,args in [
 ('dependabot',['gh','api','repos/supremperf/GarageFlowsV2/dependabot/alerts?state=open&per_page=100']),
 ('protection',['gh','api','repos/supremperf/GarageFlowsV2/branches/arena%2Fc9eaae15-garageflowsv2/protection']),
 ('logs-77558ca',['gh','run','view','38583146598','--log-failed']),
 ('gitleaks-json-source',['gh','api','repos/gitleaks/gitleaks/contents/report/json.go?ref=v8.24.3']),
]:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();p=subprocess.run(args,capture_output=True,text=True,timeout=60)
 row={'id':label,'argv':args,'startedAt':start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode}
 if label=='dependabot' and p.returncode==0:
  data=json.loads(p.stdout);safe=[]
  for x in data:
   a=x.get('security_advisory',{});v=x.get('security_vulnerability',{});d=x.get('dependency',{})
   safe.append({'number':x.get('number'),'state':x.get('state'),'updated_at':x.get('updated_at'),'url':x.get('html_url'),'package':d.get('package'),'manifest':d.get('manifest_path'),'scope':d.get('scope'),'relationship':d.get('relationship'),'severity':a.get('severity'),'ghsa_id':a.get('ghsa_id'),'vulnerable_version_range':v.get('vulnerable_version_range'),'first_patched_version':v.get('first_patched_version')})
  row['alerts']=safe;row['limitation']='First API page; pagination required before completeness claim.'
 elif label=='gitleaks-json-source' and p.returncode==0:
  import base64
  data=json.loads(p.stdout);code=base64.b64decode(data['content']);row.update({'upstreamBlobSha':data['sha'],'sourceSha256':hashlib.sha256(code).hexdigest(),'sourceText':code.decode()})
 else:
  # Keep the diagnostic, but remove ALL query strings from every URL first.
  error=p.stderr
  error=re.sub(r'https?://[^\s\"<>]+',lambda m:m.group(0).split('?')[0]+'[query omitted]',error)
  row['sanitizedDiagnostic']=error
  row['stdoutOmitted']=True
 results.append(row)
(B/'external-access.json').write_text(json.dumps({'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'limitations':'No raw scanner log/secret persisted. URL query omission is not a general secret detector.'},indent=2))
print(json.dumps([{'id':r['id'],'exitCode':r['exitCode'],'diagnostic':r.get('sanitizedDiagnostic'),'alertCount':len(r.get('alerts',[])) if 'alerts' in r else None} for r in results],indent=2))

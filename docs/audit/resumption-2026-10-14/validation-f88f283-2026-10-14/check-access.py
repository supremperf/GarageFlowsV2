import subprocess,json,datetime,pathlib,re
B=pathlib.Path(__file__).resolve().parent
rows=[]
for label,endpoint in [('dependabot','repos/supremperf/GarageFlowsV2/dependabot/alerts?state=open&per_page=100'),('branch-protection','repos/supremperf/GarageFlowsV2/branches/arena%2Fc9eaae15-garageflowsv2/protection'),('main-protection','repos/supremperf/GarageFlowsV2/branches/main/protection'),('branch-effective-rules','repos/supremperf/GarageFlowsV2/rules/branches/arena%2Fc9eaae15-garageflowsv2')]:
 argv=['gh','api',endpoint,'--paginate'];start=datetime.datetime.now(datetime.timezone.utc).isoformat();p=subprocess.run(argv,capture_output=True,text=True,timeout=60)
 row={'id':label,'argv':argv,'startedAt':start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode}
 if p.returncode:
  # Publish only status code and canonical authorization phrase; never raw arbitrary payload.
  row['httpCodes']=re.findall(r'HTTP (\d{3})',p.stderr)
  row['resourceNotAccessibleByIntegration']='Resource not accessible by integration' in (p.stderr+p.stdout)
  row['status']='BLOQUÉ';row['alertsUnknown']=label=='dependabot'
 else:
  values=[];text=p.stdout.lstrip();dec=json.JSONDecoder()
  while text:
   value,n=dec.raw_decode(text);values.extend(value if isinstance(value,list) else [value]);text=text[n:].lstrip()
  if label=='dependabot':
   row['alerts']=[{'number':a.get('number'),'state':a.get('state'),'updated_at':a.get('updated_at'),'url':a.get('html_url'),'package':a.get('dependency',{}).get('package'),'manifest':a.get('dependency',{}).get('manifest_path'),'scope':a.get('dependency',{}).get('scope'),'relationship':a.get('dependency',{}).get('relationship'),'severity':a.get('security_advisory',{}).get('severity'),'ghsa_id':a.get('security_advisory',{}).get('ghsa_id'),'vulnerable_version_range':a.get('security_vulnerability',{}).get('vulnerable_version_range'),'first_patched_version':a.get('security_vulnerability',{}).get('first_patched_version')} for a in values]
  else:row['rules']=values
  row['status']='PARTIELLEMENT VALIDÉ'
 rows.append(row)
(B/'external-access.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows,indent=2))

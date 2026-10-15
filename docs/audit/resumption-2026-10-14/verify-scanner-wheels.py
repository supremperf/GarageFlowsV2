"""Verify every downloaded scanner wheel against the official versioned PyPI SHA256.
This isolated audit tool does not change any production dependencies.
"""
import hashlib,json,pathlib,urllib.request,concurrent.futures
from pip._vendor.packaging.utils import parse_wheel_filename
ROOT=pathlib.Path(__file__).resolve().parent
WHEELS=pathlib.Path('/home/user/audit-resumption/.cache/semgrep-wheels')
def check(wheel):
    name,version,_,_=parse_wheel_filename(wheel.name)
    url=f'https://pypi.org/pypi/{name}/{version}/json'
    with urllib.request.urlopen(url,timeout=45) as response: metadata=json.load(response)
    release=next(a for a in metadata['urls'] if a['filename']==wheel.name)
    actual=hashlib.sha256(wheel.read_bytes()).hexdigest()
    if actual!=release['digests']['sha256']: raise RuntimeError(f'upstream SHA256 mismatch: {wheel.name}')
    return {'name':str(name),'version':str(version),'file':wheel.name,'sha256':actual,'upstreamMetadata':url,'upstreamDistribution':release['url'],'upstreamHashMatches':True,'metadataVulnerabilities':metadata.get('vulnerabilities',[])}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=sorted(pool.map(check,WHEELS.glob('*.whl')),key=lambda x:x['name'])
if not rows or not any(r['name']=='semgrep' for r in rows):raise RuntimeError('scanner wheel absent')
with (ROOT/'scanner-wheel-provenance.json').open('x') as f:json.dump(rows,f,indent=2)
with (ROOT/'scanner-requirements-linux.txt').open('x') as f:
    f.write('# Actual Linux/Python 3.11 wheels; all verified against versioned official PyPI metadata.\n')
    for r in rows:f.write(f"{r['name']}=={r['version']} --hash=sha256:{r['sha256']}\n")
print(json.dumps({'wheels':len(rows),'allOfficialHashesMatch':True,'metadataAdvisories':sum(len(r['metadataVulnerabilities']) for r in rows),'limitation':'PyPI metadata is not an independent complete vulnerability audit; this scanner is not a product dependency.'}))

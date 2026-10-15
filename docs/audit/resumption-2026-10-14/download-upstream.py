"""Fetch only previously resolved official GitHub commits, outside product sources."""
import hashlib,io,json,pathlib,sys,tarfile,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
name=sys.argv[1]
choices={'redis':('redis/redis','redis-source-ref'), 'rules':('semgrep/semgrep-rules','rules-source-ref')}
repo,proof=choices[name]
ref=json.loads((ROOT/'evidence'/f'{proof}.log').read_text())
sha=ref['sha']
if len(sha)!=40 or any(c not in '0123456789abcdef' for c in sha):raise RuntimeError('invalid resolved commit')
url=f'https://codeload.github.com/{repo}/tar.gz/{sha}'
dest=pathlib.Path('/home/user/audit-resumption/.cache/upstreams')/name
if dest.exists():raise RuntimeError('refusing to overwrite source fixture')
with urllib.request.urlopen(url,timeout=90) as response:data=response.read()
dest.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
    members=archive.getmembers()
    for member in members:
        if member.name.startswith('/') or '..' in pathlib.PurePosixPath(member.name).parts or not (member.isdir() or member.isfile()):raise RuntimeError('unexpected archive path/type: '+member.name)
    archive.extractall(dest,members=members)
children=list(dest.iterdir())
if len(children)!=1 or not children[0].is_dir():raise RuntimeError('unexpected archive layout')
row={'repository':repo,'resolvedCommit':sha,'url':url,'archiveSha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'sourceDirectory':str(children[0]),'commitVerification':ref['verification'],'limitation':'Official HTTPS + API-resolved commit provenance; archive SHA256 recorded locally, not represented as an upstream published signature.'}
with (ROOT/f'{name}-source-provenance.json').open('x') as f:json.dump(row,f,indent=2)
print(json.dumps(row,indent=2))

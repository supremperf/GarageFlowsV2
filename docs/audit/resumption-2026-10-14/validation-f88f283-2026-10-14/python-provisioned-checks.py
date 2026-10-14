from run import *
pyenv={'PATH':'/home/user/audit-followup/tools/node_modules/.bin:/home/user/audit-resumption/.venv/bin:'+os.environ['PATH']}
run('python-prerequisites',['python3','-c','import sys,cryptography; print(sys.executable); print(sys.version); print(cryptography.__version__)'],60,pyenv)
run('keygen-isolated-provisioned',['node','node_modules/vitest/vitest.mjs','run','src/lib/license/__tests__/license-keygen-e2e.test.ts','--reporter=json','--outputFile='+str((B/'evidence/keygen-isolated-provisioned.json').relative_to(ROOT))],120,pyenv)
run('full-suite-provisioned',['npm','test','--','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile.json='+str((B/'evidence/full-suite-provisioned.json').relative_to(ROOT))],900,pyenv)

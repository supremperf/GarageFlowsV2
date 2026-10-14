from run import *
run('prisma-network',['node',str((B/'diagnose-network.cjs').relative_to(ROOT))],90)
run('access',['python3',str((B/'check-access.py').relative_to(ROOT))],300)
run('semgrep',['node',str((B/'run-semgrep.cjs').relative_to(ROOT))],600)

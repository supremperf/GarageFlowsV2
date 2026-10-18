from run import *
run('typecheck-settled',['node','node_modules/typescript/bin/tsc','--noEmit'],180)
run('semgrep-settled',['node',str((B/'run-semgrep-settled.cjs').relative_to(ROOT))],600)
run('prisma-generate',['node','node_modules/prisma/build/index.js','generate'],120)
run('prisma-server-generate',['node','node_modules/prisma/build/index.js','generate','--schema','prisma/server/schema.prisma'],120)

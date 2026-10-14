from run import *
C=ROOT/'docs/audit/resumption-2026-10-14/closure-2026-10-14'
old={j['id']:j for j in map(json.loads,(C/'commands.jsonl').read_text().splitlines())}
run('tool-versions',['bash','-c','node --version; npm --version; node -p "require(\'typescript\').version"; node -p "require(\'prisma/package.json\').version"; node -p "require(\'vitest/package.json\').version"; /home/user/audit-resumption/.venv/bin/semgrep --version'],120)
for id,oldid in [('typecheck','typecheck-candidate'),('lint','lint-candidate' if 'lint-candidate' in old else 'lint-final'),('authz','authz-after'),('backup','backup-regression'),('redaction','corrections-regression'),('gcm-composite','gcm-historical-suite'),('release-safety','release-safety'),('audit-strict','audit-strict')]:
 argv=old[oldid]['argv']
 argv=[a.replace('closure-2026-10-14/evidence/'+oldid,'validation-f88f283-2026-10-14/evidence/'+id) for a in argv]
 run(id,argv,600)
run('prepare-db-isolated',['node','node_modules/vitest/vitest.mjs','run','src/test-utils/__tests__/prepare-test-db.test.ts','--reporter=default','--reporter=json','--outputFile.json='+str((B/'evidence/prepare-db-isolated.json').relative_to(ROOT))],240)
for id,file in [('publication-isolated','src/integration/publication-mise-a-jour.test.ts'),('license-devices-isolated','src/lib/__tests__/license-devices-unit.test.ts'),('mechanic-admin-isolated','src/lib/__tests__/mechanic-admin.test.ts'),('audit-v21-isolated','src/lib/__tests__/audit-v21-fixes.test.ts'),('invoice-isolated','src/integration/invoice-authz.test.ts')]:
 run(id,['node','node_modules/vitest/vitest.mjs','run',file,'--reporter=default','--reporter=json','--outputFile.json='+str((B/f'evidence/{id}.json').relative_to(ROOT))],180)
run('full-suite',['npm','test','--','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile.json='+str((B/'evidence/full-suite.json').relative_to(ROOT))],900)
run('standard-build',['npm','run','build'],240)
run('budget-diagnostic',['npm','run','check:perf-budget'],120)
run('consistency',['npm','run','check:consistency'],240)

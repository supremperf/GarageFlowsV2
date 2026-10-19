// Read-only collection over git-visible files; not a semantic/security certification.
// Reproduce: node docs/audit/2026-10-17/phase6/collect-review-inventory.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createRequire } from 'node:module'
const output = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(output, '../../../..')
const { readGitEntry } = createRequire(import.meta.url)(path.join(root, 'scripts/lib/file-snapshot.cjs'))
const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort()
const scope = p => p.startsWith('src/app/api/') ? 'D/API' : p.endsWith('.tsx') ? 'K/UI' : p.startsWith('prisma/') ? 'J/DB' : /\.md$/.test(p) ? 'G/docs' : /(?:^|\/)(?:LICENSE|THIRD_PARTY_NOTICES)/.test(p) ? 'F/licenses' : /^(?:scripts|electron|\.github)\//.test(p) ? 'I/tooling' : 'A/other'
const rows = ['path\tsha256\tbytes\tcategory\tsemanticStatus']
const routes = [], ui = [], signals = [], encoding = { files: 0, utf8: 0, binary: [], invalidUtf8Text: [], bom: [], replacementCharacter: [] }
const signalPatterns = {
  rawUnsafeSQL: /\$(?:query|execute)RawUnsafe\s*\(/,
  evalOrNewFunction: /\beval\s*\(|new\s+Function\s*\(/,
  rawHTML: /dangerouslySetInnerHTML/,
  shellExecution: /\b(?:execSync|exec|spawn|execFileSync)\s*\(/,
  uncheckedPagination: /Math\.(?:max|min).*parseInt\(.*searchParams\.get\(['"](?:page|limit)/,
}
for (const p of paths) {
  const file = path.join(root, p)
  let bytes
  try { bytes = readGitEntry(file) } catch (error) { if (['ENOENT', 'EISDIR'].includes(error.code)) continue; throw error }
  // Self-generated outputs are evidence, not source to recursively hash into themselves.
  if (['review-inventory.tsv','route-inventory.json','ui-inventory.json','static-signals.json','encoding.json'].some(n => p === path.relative(root, path.join(output, n)))) continue
  rows.push([p, crypto.createHash('sha256').update(bytes).digest('hex'), bytes.length, scope(p), 'inventoried; semantic completeness NOT attested'].join('\t'))
  encoding.files++
  const binary = /\.(?:db|png|ico|jpg|woff2?|exe|zip|pdf|webp)$/i.test(p)
  if (binary) { encoding.binary.push(p); continue }
  let text
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); encoding.utf8++ }
  catch { encoding.invalidUtf8Text.push(p); continue }
  if (bytes.subarray(0,3).equals(Buffer.from([239,187,191]))) encoding.bom.push(p)
  if (text.includes('\uFFFD')) encoding.replacementCharacter.push(p) // literals can be intentional; not automatically corruption
  if (/^(?:src|scripts|electron)\//.test(p) && /\.(?:ts|tsx|mjs|js|cjs)$/.test(p)) {
    const lines = text.split('\n')
    for (let i=0;i<lines.length;i++) for (const [signal,re] of Object.entries(signalPatterns)) if (re.test(lines[i])) signals.push({ file:p,line:i+1,signal,conclusion:'review cue only; not a confirmed vulnerability' })
  }
  if (/^src\/app\/api\/.*\/route\.ts$/.test(p)) {
    const ast = ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true)
    const methods = []
    for (const node of ast.statements) {
      if (!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      if (ts.isFunctionDeclaration(node) && node.name && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(node.name.text)) methods.push({ name:node.name.text,line:ast.getLineAndCharacterOfPosition(node.getStart()).line+1,kind:'function' })
      if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name) && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(d.name.text)) methods.push({name:d.name.text,line:ast.getLineAndCharacterOfPosition(d.getStart()).line+1,kind:d.initializer && ts.isCallExpression(d.initializer) ? d.initializer.expression.getText(ast) : 'variable'})
    }
    const markers = ['withAuth','requireSession','isAdminSession','withLicenseApi','authenticateGarage','requireMechanic','requirePortal','enforceRateLimit','assertRelations','garageId'].filter(m => text.includes(m))
    routes.push({ file:p,methods,markers,semanticStatus:'not certified by marker presence; delegated guards may exist' })
  }
  if (/^src\/.*\.tsx$/.test(p)) ui.push({file:p,lines:text.split('\n').length,markers:['aria-label','role=','htmlFor=','alt=','useEffect','fetch('].filter(m => text.includes(m)),semanticStatus:'not an accessibility/render/browser verification'})
}
const write = (name,data) => fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n')
fs.writeFileSync(path.join(output,'review-inventory.tsv'),rows.join('\n')+'\n')
write('route-inventory.json',routes);write('ui-inventory.json',ui);write('static-signals.json',signals);write('encoding.json',encoding)
console.log(JSON.stringify({ files:encoding.files,routes:routes.length,handlers:routes.reduce((s,r)=>s+r.methods.length,0),uiFiles:ui.length,signals:signals.length,invalidUtf8:encoding.invalidUtf8Text.length }))

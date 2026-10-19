'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), os = require('node:os'), ts = require('typescript')
const text = fs.readFileSync(path.join(__dirname, '../scripts/config-core.cjs'), 'utf8')
const ast = ts.createSourceFile('config-core.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'writePrivate')
for (const exclusive of [false, true]) {
  test('private writer sets permissions on its owned descriptor, not a replaced path; exclusive=' + exclusive, () => {
    const events = []
    const io = { mkdirSync() {}, lstatSync() { throw Object.assign(Error(), { code: 'ENOENT' }) },
      openSync: (_file, flag, mode) => { assert.equal(flag, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 51 },
      writeFileSync: (fd, value) => { assert.equal(fd, 51); assert.equal(value, 'fixture'); events.push('write') },
      fchmodSync: (fd, mode) => { assert.equal(fd, 51); assert.equal(mode, 0o600); events.push('permissions') },
      closeSync: fd => { assert.equal(fd, 51); events.push('close') },
      renameSync: () => { assert.ok(events.includes('permissions')); assert.ok(events.includes('close')); events.push('rename-path-can-now-change') },
      chmodSync: () => { throw Error('Unsafe permission update through a replaceable path') }, rmSync() {} }
    const write = vm.runInNewContext('(' + declaration.getText(ast) + ')', { fs: io, path, crypto: require('node:crypto') })
    write('/fixture/private.env', 'fixture', { exclusive })
    assert.deepEqual(events, exclusive ? ['open', 'write', 'permissions', 'close'] : ['open', 'write', 'permissions', 'close', 'rename-path-can-now-change'])
  })
}
test('failed permissions keep the old private file and remove only an owned temporary', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-private-permissions-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, '.env'); fs.writeFileSync(file, 'old-fixture')
  const io = { ...fs, fchmodSync() { throw Object.assign(Error('fixture permission failure'), { code: 'EACCES' }) } }
  const write = vm.runInNewContext('(' + declaration.getText(ast) + ')', { fs: io, path, crypto: require('node:crypto') })
  assert.throws(() => write(file, 'new-fixture'), { code: 'EACCES' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'old-fixture')
  assert.deepEqual(fs.readdirSync(root), ['.env'])
})

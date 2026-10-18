'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const { readRegularFile, readGitEntry } = require('../scripts/lib/file-snapshot.cjs')
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-file-snapshot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
test('checks and reads the same opened object even when the name would resolve to replacement data', () => {
  const calls = []
  const io = {
    openSync: () => 41,
    fstatSync: fd => { calls.push(['stat', fd]); return { isFile: () => true, size: 8 } },
    readFileSync: fd => { calls.push(['read', fd]); return Buffer.from(typeof fd === 'number' ? 'original' : 'replacement') },
    closeSync: fd => calls.push(['close', fd]),
  }
  assert.equal(readRegularFile('/fixture/path-changed', { io }).toString(), 'original')
  assert.deepEqual(calls, [['stat', 41], ['read', 41], ['close', 41]])
})
test('hard read bound survives a stale size and closes the descriptor on growth/error', () => {
  let closed = 0, reads = 0
  const io = { openSync: () => 42, fstatSync: () => ({ isFile: () => true, size: 0 }),
    readSync: (_fd, buffer, offset, length) => { reads++; buffer.fill(65, offset, offset + length); return length },
    closeSync: () => closed++ }
  assert.throws(() => readRegularFile('/fixture/grown', { maxBytes: 3, io }), { code: 'EFBIG' })
  assert.equal(closed, 1); assert.equal(reads, 1)
})
test('real regular-file, missing, oversized and directory cases retain their error semantics', t => {
  const root = temporary(t), file = path.join(root, 'regular.js')
  fs.writeFileSync(file, 'marker')
  assert.equal(readRegularFile(file, { maxBytes: 6 }).toString(), 'marker')
  assert.throws(() => readRegularFile(file, { maxBytes: 5 }), { code: 'EFBIG' })
  assert.throws(() => readRegularFile(path.join(root, 'missing')), { code: 'ENOENT' })
  assert.throws(() => readRegularFile(root))
  assert.throws(() => readRegularFile(file, { maxBytes: -1 }))
  assert.equal(readGitEntry(file).toString(), 'marker')
})
for (const rel of [
  'docs/audit/resumption-2026-10-14/run-command.cjs',
  'docs/audit/resumption-2026-10-14/investigation-2026-10-14/run-command.cjs',
  'docs/audit/resumption-2026-10-14/closure-2026-10-14/run-command.cjs',
]) {
  test(rel + ' reserves a proof before executing and refuses reuse without touching old data', t => {
    const root = temporary(t), dirname = path.join(root, path.dirname(rel))
    fs.mkdirSync(dirname, { recursive: true })
    const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    let spawned = 0
    const cp = { spawnSync: () => { spawned++; return { status: 0, stdout: 'owned output', stderr: '' } }, execFileSync: () => Buffer.from('fixture metadata') }
    const run = () => vm.runInNewContext(source, { __dirname: dirname, require: name => name === 'node:child_process' ? cp : require(name),
      process: { argv: ['node', 'fixture', 'proof', 'fixture-command'], env: { AUDIT_COMMAND_TIMEOUT_MS: '1000', PATH: '' } }, console: { log() {} } })
    run()
    const dest = path.join(dirname, 'evidence/proof.log')
    assert.equal(fs.readFileSync(dest, 'utf8'), 'owned output')
    assert.equal(spawned, 1)
    assert.throws(run, { code: 'EEXIST' })
    assert.equal(spawned, 1, 'preexisting proof must prevent the command itself')
    assert.equal(fs.readFileSync(dest, 'utf8'), 'owned output')
  })
}

test('Git entry snapshots read link text itself without opening its target', () => {
  let opened = false
  const io = { readlinkSync: () => '../outside-private-target', openSync: () => { opened = true; throw Error('Must not open link target') } }
  assert.equal(readGitEntry('/fixture/link', { io }).toString(), '../outside-private-target')
  assert.equal(opened, false)
})

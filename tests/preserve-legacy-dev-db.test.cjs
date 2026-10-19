'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { preserveLegacyDevDb } = require('../scripts/lib/preserve-legacy-dev-db.cjs')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-legacy-unit-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true })) // test-owned temporary data only
  fs.mkdirSync(path.join(root, 'prisma'))
  return root
}
function create(file, marker) {
  const db = new DatabaseSync(file)
  try { db.exec('CREATE TABLE Marker (value TEXT)'); db.prepare('INSERT INTO Marker VALUES (?)').run(marker) }
  finally { db.close() }
}
function read(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return db.prepare('SELECT value FROM Marker').get().value } finally { db.close() }
}
test('copies a real legacy SQLite database exclusively and keeps its original', t => {
  const root = fixture(t), src = path.join(root, 'prisma', 'dev.db'), dest = path.join(root, 'dev.db')
  create(src, 'legacy'); const bytes = fs.readFileSync(src)
  assert.equal(preserveLegacyDevDb(root, () => {}), 'copied')
  assert.deepEqual(fs.readFileSync(src), bytes); assert.deepEqual(fs.readFileSync(dest), bytes)
  assert.equal(read(dest), 'legacy')
})
test('never deletes either distinct database or other nested files when canonical exists', t => {
  const root = fixture(t), src = path.join(root, 'prisma', 'dev.db'), dest = path.join(root, 'dev.db')
  create(src, 'legacy'); create(dest, 'canonical')
  fs.writeFileSync(path.join(root, 'prisma', 'preserve.txt'), 'user-owned')
  const before = [fs.readFileSync(src), fs.readFileSync(dest)]
  for (let i = 0; i < 2; i++) assert.equal(preserveLegacyDevDb(root, () => {}), 'preserved')
  assert.deepEqual(fs.readFileSync(src), before[0]); assert.deepEqual(fs.readFileSync(dest), before[1])
  assert.equal(read(src), 'legacy'); assert.equal(read(dest), 'canonical')
  assert.equal(fs.readFileSync(path.join(root, 'prisma', 'preserve.txt'), 'utf8'), 'user-owned')
})
test('absent legacy database does not overwrite a canonical SQLite database', t => {
  const root = fixture(t), dest = path.join(root, 'dev.db'); create(dest, 'canonical')
  const before = fs.readFileSync(dest)
  assert.equal(preserveLegacyDevDb(root, () => {}), 'absent')
  assert.deepEqual(fs.readFileSync(dest), before)
})
test('actual setup-dev bootstrap preserves both databases and unrelated nested files', t => {
  const root = fixture(t), app = path.join(root, 'app'), prisma = path.join(app, 'prisma')
  fs.mkdirSync(path.join(app, 'scripts', 'lib'), { recursive: true })
  fs.mkdirSync(path.join(prisma, 'prisma'), { recursive: true })
  for (const file of ['setup-dev.js', 'secrets.js', 'lib/preserve-legacy-dev-db.cjs']) {
    fs.copyFileSync(path.join('scripts', file), path.join(app, 'scripts', file))
  }
  const canonical = path.join(prisma, 'dev.db'), legacy = path.join(prisma, 'prisma', 'dev.db')
  create(canonical, 'canonical'); create(legacy, 'legacy')
  const extra = path.join(prisma, 'prisma', 'preserve.txt'); fs.writeFileSync(extra, 'user-owned')
  const bytes = [fs.readFileSync(canonical), fs.readFileSync(legacy)]
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(app, 'scripts', 'setup-dev.js')], {
    cwd: app, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readFileSync(canonical), bytes[0]); assert.deepEqual(fs.readFileSync(legacy), bytes[1])
  assert.equal(fs.readFileSync(extra, 'utf8'), 'user-owned')
})

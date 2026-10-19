'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const { copyPrismaResources } = require('../scripts/lib/package-prisma-resources.cjs')
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-package-'))
  fs.mkdirSync(path.join(root, 'prisma'))
  fs.writeFileSync(path.join(root, 'prisma/schema.prisma'), 'fixture-schema')
  const db = new DatabaseSync(path.join(root, 'prisma/garageflow-template.db'))
  db.exec('CREATE TABLE Customer (name TEXT); CREATE TABLE _gf_migrations (id TEXT); INSERT INTO _gf_migrations VALUES (\'baseline\')'); db.close()
  try { fn(root, path.join(root, 'standalone')) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
test('copies only schema and empty template; leaves local user DB unchanged', () => fixture((root, out) => {
  fs.writeFileSync(path.join(root, 'prisma/dev.db'), 'DO NOT DISTRIBUTE OR DELETE')
  copyPrismaResources(root, out)
  assert.deepEqual(fs.readdirSync(path.join(out, 'prisma')).sort(), ['garageflow-template.db', 'schema.prisma'])
  assert.equal(fs.readFileSync(path.join(root, 'prisma/dev.db'), 'utf8'), 'DO NOT DISTRIBUTE OR DELETE')
}))
test('missing template never falls back to local DB', () => fixture((root, out) => {
  fs.unlinkSync(path.join(root, 'prisma/garageflow-template.db'))
  fs.writeFileSync(path.join(root, 'prisma/dev.db'), 'LOCAL DATA')
  assert.throws(() => copyPrismaResources(root, out), /ENOENT/)
  assert.equal(fs.readFileSync(path.join(root, 'prisma/dev.db'), 'utf8'), 'LOCAL DATA')
}))
test('nonempty template is refused without changing it', () => fixture((root, out) => {
  const p = path.join(root, 'prisma/garageflow-template.db'), db = new DatabaseSync(p)
  db.exec("INSERT INTO Customer VALUES ('PRIVATE FIXTURE')"); db.close()
  const before = fs.readFileSync(p)
  assert.throws(() => copyPrismaResources(root, out), /application data/)
  assert.deepEqual(fs.readFileSync(p), before)
}))
test('stale databases in output fail closed rather than being packaged or deleted', () => fixture((root, out) => {
  fs.mkdirSync(path.join(out, 'prisma'), { recursive: true })
  fs.writeFileSync(path.join(out, 'prisma/dev.db'), 'stale')
  assert.throws(() => copyPrismaResources(root, out), /Unexpected database/)
  assert.equal(fs.readFileSync(path.join(out, 'prisma/dev.db'), 'utf8'), 'stale')
}))
test('packaging filter cannot wildcard local databases', () => {
  const resources = require('../package.json').build.extraResources.find(r => r.from === 'prisma')
  assert.deepEqual(resources.filter, ['schema.prisma', 'garageflow-template.db'])
})
test('refuses an output directory junction without overwriting its external target', () => fixture((root, out) => {
  const external = path.join(root, 'outside-output'); fs.mkdirSync(external)
  fs.writeFileSync(path.join(external, 'schema.prisma'), 'UNRELATED USER FILE')
  fs.mkdirSync(out); fs.symlinkSync(external, path.join(out, 'prisma'), 'junction')
  assert.throws(() => copyPrismaResources(root, out), /symlink|junction/i)
  assert.equal(fs.readFileSync(path.join(external, 'schema.prisma'), 'utf8'), 'UNRELATED USER FILE')
  assert.deepEqual(fs.readdirSync(external), ['schema.prisma'])
}))
test('refuses a source directory junction without touching its files', () => fixture((root, out) => {
  const external = path.join(root, 'outside-source'), source = path.join(root, 'prisma')
  fs.renameSync(source, external); fs.symlinkSync(external, source, 'junction')
  const before = fs.readFileSync(path.join(external, 'garageflow-template.db'))
  assert.throws(() => copyPrismaResources(root, out), /symlink|junction/i)
  assert.deepEqual(fs.readFileSync(path.join(external, 'garageflow-template.db')), before)
  assert.equal(fs.existsSync(out), false)
}))

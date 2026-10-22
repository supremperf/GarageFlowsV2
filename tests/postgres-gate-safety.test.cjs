'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

async function helper() {
  return import('../scripts/lib/postgres-test-database.mjs')
}

test('PostgreSQL gate generates bounded, unique and deterministic identifiers from entropy', async () => {
  const { temporaryPostgresDatabaseName } = await helper()
  const zero = temporaryPostgresDatabaseName(Buffer.alloc(8, 0))
  const max = temporaryPostgresDatabaseName(Buffer.alloc(8, 0xff))
  assert.equal(zero, 'gf_gate_check_0000000000000000')
  assert.equal(max, 'gf_gate_check_ffffffffffffffff')
  assert.notEqual(zero, max)
  assert.match(zero, /^gf_gate_check_[a-f0-9]{16}$/)
  assert.ok(zero.length <= 63)
})

test('PostgreSQL gate rejects insufficient or excessive entropy', async () => {
  const { temporaryPostgresDatabaseName } = await helper()
  assert.throws(() => temporaryPostgresDatabaseName(Buffer.alloc(7)), /Exactly 8 bytes/)
  assert.throws(() => temporaryPostgresDatabaseName(Buffer.alloc(9)), /Exactly 8 bytes/)
})

test('PostgreSQL gate contains no database deletion or reusable fixed database', () => {
  const source = fs.readFileSync(path.resolve('scripts/gate-fresh-postgres.mjs'), 'utf8')
  assert.doesNotMatch(source, /DROP\s+DATABASE/i)
  assert.doesNotMatch(source, /const\s+SCRATCH_DB\s*=\s*['"]gf_gate_check['"]/)
  assert.match(source, /temporaryPostgresDatabaseName\(\)/)
  assert.match(source, /CREATE DATABASE "\$\{SCRATCH_DB\}"/)
})

test('PostgreSQL gate refuses to run without an explicit test administration URL', () => {
  const env = { ...process.env }
  delete env.TEST_POSTGRES_URL
  const result = spawnSync(process.execPath, ['scripts/gate-fresh-postgres.mjs'], {
    cwd: path.resolve('.'),
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /TEST_POSTGRES_URL est requis/)
})

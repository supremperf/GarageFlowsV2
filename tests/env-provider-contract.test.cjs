'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { normalizeStorage } = require('../scripts/config-rebuild.cjs')
const core = require('../scripts/config-core.cjs')
const credentials = require('../scripts/lib/config-credentials.cjs')
const { loadPolicy, assertNoAliases } = require('../scripts/config-policy.cjs')
const root = path.resolve(__dirname, '..')
const policy = loadPolicy(root)

test('provider INPUT direct alias is canonicalized and stripped, never mutates source', () => {
  const source = { DATABASE_URL_UNPOOLED: 'postgresql://fixture.invalid/db?sslmode=require' }
  const out = normalizeStorage(source)
  assert.equal(out.DIRECT_URL, source.DATABASE_URL_UNPOOLED)
  assert.ok(!Object.hasOwn(out, 'DATABASE_URL_UNPOOLED'))
  assert.ok(Object.hasOwn(source, 'DATABASE_URL_UNPOOLED'))
  assert.doesNotThrow(() => assertNoAliases(out, policy))
  assert.match(core.serializeEnv(out, policy.names, 'pwa'), /DIRECT_URL=/)
  assert.ok(!core.serializeEnv(out, policy.names, 'pwa').includes('DATABASE_URL_UNPOOLED='))
})

test('contradictory direct sources refuse before export, without leaking values', () => {
  const source = { DIRECT_URL: 'postgresql://canonical-fixture.invalid/db', DATABASE_URL_UNPOOLED: 'postgresql://conflicting-fixture.invalid/db' }
  assert.throws(() => normalizeStorage(source), e => e.configSafe && !e.message.includes('fixture.invalid'))
  const same = normalizeStorage({ DIRECT_URL: source.DIRECT_URL, DATABASE_URL_UNPOOLED: source.DIRECT_URL })
  assert.equal(same.DIRECT_URL, source.DIRECT_URL)
  assert.ok(!Object.hasOwn(same, 'DATABASE_URL_UNPOOLED'))
})

test('legacy runtime alias remains forbidden; unrelated aliases are not silently accepted', () => {
  assert.throws(() => assertNoAliases({ DATABASE_URL_UNPOOLED: 'fixture' }, policy))
  assert.throws(() => assertNoAliases(normalizeStorage({ PWA_DATABASE_URL: 'fixture' }), policy))
  assert.ok(!Object.hasOwn(credentials.neonVariables('fixture-not-issued'), 'DATABASE_URL_UNPOOLED'))
})

test('guard still detects reintroduction in active code, even in an input parser file', () => {
  // Isolated copy: never mutate the real worktree while other suites run.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-env-guard-'))
  try {
    for (const name of ['scripts', 'src', 'electron', 'prisma', 'e2e', '.github', 'config', 'docs', 'package.json', 'next.config.mjs', 'playwright.config.ts', '.env.example', '.env.storage.example', 'ENVIRONMENT-VARIABLES.md']) {
      const src = path.join(root, name)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, name), { recursive: true, filter: p => !/[/\\](?:generated|__pycache__)(?:[/\\]|$)/.test(p) })
    }
    const target = path.join(tmp, 'scripts/config-rebuild.cjs')
    fs.appendFileSync(target, '\n// forbidden active runtime regression\nprocess.env.DATABASE_URL_UNPOOLED = "fixture"\n')
    assert.throws(() => execFileSync(process.execPath, ['scripts/check-env-consistency.mjs'], { cwd: tmp, stdio: 'pipe' }), e => e.status === 1 && e.stderr.includes('alias INTERDIT'))
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

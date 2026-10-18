'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const asar = require('@electron/asar')
const { projectRuntimeModules } = require('../scripts/lib/installed-runtime-modules.cjs')
test('real ASAR production closure is projected to standalone, preserving the generated native client', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-runtime-modules-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const input = path.join(root, 'input'), resources = path.join(root, 'resources')
  for (const name of ['next', 'react', 'react-dom', '@prisma/client', 'fixture-transitive']) {
    const dir = path.join(input, 'node_modules', name); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {}')
  }
  fs.mkdirSync(resources)
  await asar.createPackage(input, path.join(resources, 'app.asar'))
  const client = path.join(resources, 'standalone/node_modules/.prisma/client')
  fs.mkdirSync(client, { recursive: true })
  fs.writeFileSync(path.join(client, 'query_engine-windows.dll.node'), 'native-fixture-marker')
  const generated = path.join(root, 'node_modules/.prisma/client')
  fs.mkdirSync(generated, { recursive: true })
  for (const file of ['index.js', 'schema.prisma', 'query_engine-windows.dll.node']) fs.writeFileSync(path.join(generated, file), 'native-fixture-marker')
  const result = projectRuntimeModules(resources, root)
  assert.equal(result.outsideAsar, true)
  assert.ok(fs.existsSync(path.join(resources, 'standalone/node_modules/fixture-transitive/index.js')))
  assert.equal(fs.readFileSync(path.join(client, 'query_engine-windows.dll.node'), 'utf8'), 'native-fixture-marker')
  assert.equal(fs.readFileSync(path.join(resources, 'standalone/node_modules/next/index.js'), 'utf8'), 'module.exports = {}')
})

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-traced-runtime-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const resources = path.join(root, 'resources')
  fs.mkdirSync(resources)
  const generated = path.join(root, 'node_modules/.prisma/client')
  fs.mkdirSync(generated, { recursive: true })
  for (const file of ['index.js', 'schema.prisma', 'query_engine-windows.dll.node']) {
    fs.writeFileSync(path.join(generated, file), 'generated-client-fixture')
  }
  return { root, resources, generated }
}
function writeModules(base) {
  for (const name of ['next', 'react', 'react-dom', '@prisma/client', 'fixture-transitive']) {
    const directory = path.join(base, 'node_modules', name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
    fs.writeFileSync(path.join(directory, 'index.js'), 'module.exports = "installed-only"')
  }
}

test('complete traced closure restores files lost by Builder filtering without borrowing checkout modules', t => {
  const { root, resources } = fixture(t)
  const traced = path.join(root, '.next/standalone')
  writeModules(traced)
  // This fixture deliberately has NO app.asar: the complete trace must be used.
  const result = projectRuntimeModules(resources, root)
  assert.equal(result.sourceMode, 'next-traced-closure')
  // Remove build inputs before loading the delivered modules.
  fs.rmSync(path.join(root, '.next'), { recursive: true })
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true })
  const resolveInstalled = require('node:module').createRequire(path.join(resources, 'standalone/server.js'))
  for (const name of [...result.runtimeModules, 'fixture-transitive']) {
    const file = resolveInstalled.resolve(name)
    assert.ok(file.startsWith(path.join(resources, 'standalone') + path.sep))
    assert.equal(resolveInstalled(name), 'installed-only')
  }
  assert.equal(fs.readFileSync(path.join(resources, 'standalone/node_modules/.prisma/client/schema.prisma'), 'utf8'), 'generated-client-fixture')
})

test('partial trace cannot resolve checkout modules and silently masquerade as a complete closure', async t => {
  const { root, resources } = fixture(t)
  const traced = path.join(root, '.next/standalone')
  fs.mkdirSync(traced, { recursive: true })
  writeModules(root) // Node resolution can see these, but delivery MUST NOT use them.
  const input = path.join(root, 'builder-production')
  writeModules(input)
  await asar.createPackage(input, path.join(resources, 'app.asar'))
  const result = projectRuntimeModules(resources, root)
  assert.equal(result.sourceMode, 'builder-production-closure')
  assert.ok(fs.existsSync(path.join(resources, 'standalone/node_modules/fixture-transitive/index.js')))
})

test('missing generated Windows engine fails packaging even with a resolvable traced closure', t => {
  const { root, resources, generated } = fixture(t)
  writeModules(path.join(root, '.next/standalone'))
  fs.rmSync(path.join(generated, 'query_engine-windows.dll.node'))
  assert.throws(() => projectRuntimeModules(resources, root), /ENOENT|Generated Windows Prisma resource missing/)
})

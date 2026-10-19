'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const lock = require('../package-lock.json')
const semver = require('semver')

function instances(name) {
  return Object.entries(lock.packages).filter(([location]) => location.endsWith('node_modules/' + name))
}
function assertPatched(name, patchedRange) {
  const found = instances(name)
  assert.ok(found.length, `${name} must remain installed; removal is not remediation`)
  for (const [location, item] of found) {
    assert.ok(!item.link, `${name}: unexpected local alias must be independently reviewed`)
    assert.ok(semver.satisfies(item.version, patchedRange), `${name}@${item.version}: below reviewed security floor`)
    const installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8'))
    assert.equal(installed.version, item.version, 'installed/locked version drift')
    assert.equal(installed.name, name)
  }
}

test('all installed Next instances include the Windows RCE and AVIF fixes, without removing Next', () => {
  // GHSA-p293-qw3h-jr36 / GHSA-2xp9-vwfh-vxw4; maintained current branch lines.
  // Registry auditing remains mandatory: this floor is not a future-CVE allowlist.
  assertPatched('next', '>=15.5.24 <16.0.0 || >=16.3.3 <17.0.0')
})
test('all tar instances include the critical decompression fix and later traversal fixes; builder resolves this tar', () => {
  // GHSA-23hp-3jrh-7fpw fixed in 7.5.19; later recorded issues require 7.5.21.
  assertPatched('tar', '>=7.5.21 <8')
  const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
  assert.equal(builderRequire.resolve('tar'), require.resolve('tar'))
  assert.ok(semver.gte(require('electron-builder/package.json').version, '26.15.3'))
})
test('patched tar aborts a bounded high-compression fixture without extracting or exhausting disk', async () => {
  const tar = require('tar')
  assert.equal(new tar.Parser().maxDecompressionRatio, 1000, 'upstream safe default must be active')
  const header = Buffer.alloc(512)
  new tar.Header({ path: 'fixture.txt', size: 32768, mode: 0o600, type: 'File' }).encode(header)
  // 34 KiB uncompressed fixture; never a multi-GB bomb and never an extractor.
  const compressed = zlib.gzipSync(Buffer.concat([header, Buffer.alloc(32768), Buffer.alloc(1024)]))
  await assert.rejects(new Promise((resolve, reject) => {
    const parser = new tar.Parser({ maxDecompressionRatio: 2, onReadEntry: entry => entry.resume() })
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.end(compressed)
  }), /max decompression ratio exceeded/)
})
test('patched tar still accepts a normal uncompressed archive and preserves file content', async () => {
  const tar = require('tar'), data = Buffer.from('GarageFlows fixture')
  const header = Buffer.alloc(512)
  new tar.Header({ path: 'fixture.txt', size: data.length, mode: 0o600, type: 'File' }).encode(header)
  const chunks = []
  await new Promise((resolve, reject) => {
    const parser = new tar.Parser({ onReadEntry: entry => entry.on('data', chunk => chunks.push(chunk)) })
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.end(Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]))
  })
  assert.equal(Buffer.concat(chunks).toString(), data.toString())
})

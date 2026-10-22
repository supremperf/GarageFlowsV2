'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const script = path.resolve('scripts/gen-third-party-notices.mjs')
function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-notices-'))
  try { run(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
function pkg(dir, location, version, text) {
  fs.mkdirSync(path.join(dir, location), { recursive: true })
  fs.writeFileSync(path.join(dir, location, 'package.json'), JSON.stringify({ name: 'fixture', version }))
  fs.writeFileSync(path.join(dir, location, 'LICENSE'), text)
  return { name: 'fixture', version, properties: [{ name: 'cdx:npm:package:path', value: location }] }
}
function generate(dir, components) {
  fs.writeFileSync(path.join(dir, 'sbom.json'), JSON.stringify({ components }))
  execFileSync(process.execPath, [script, '--sbom', 'sbom.json', '--out', 'notices.md'], { cwd: dir, stdio: 'pipe' })
  return fs.readFileSync(path.join(dir, 'notices.md'), 'utf8')
}
test('license text is complete past 8000 characters and nested versions keep their own license', () => fixture(dir => {
  const long = 'LICENSE-START\n' + 'x'.repeat(12000) + '\nLICENSE-END'
  const a = pkg(dir, 'node_modules/fixture', '1.0.0', long)
  const b = pkg(dir, 'node_modules/parent/node_modules/fixture', '2.0.0', 'OTHER-VERSION-LICENSE')
  const out = generate(dir, [a, b])
  assert.ok(out.includes(long))
  assert.match(out, /### fixture@2\.0\.0[\s\S]*OTHER-VERSION-LICENSE/)
}))
test('wrong SBOM package version is refused instead of attributing another installed version', () => fixture(dir => {
  const a = pkg(dir, 'node_modules/fixture', '1.0.0', 'license')
  a.version = '9.0.0'
  assert.throws(() => generate(dir, [a]))
}))
test('SBOM cannot point license discovery outside node_modules', () => fixture(dir => {
  const a = pkg(dir, 'outside', '1.0.0', 'do not read')
  assert.throws(() => generate(dir, [a]))
}))

function upstreamPkg(dir, name, version, licenseText) {
  const location = path.join('node_modules', name)
  fs.mkdirSync(path.join(dir, location), { recursive: true })
  fs.writeFileSync(path.join(dir, location, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }))
  if (licenseText) fs.writeFileSync(path.join(dir, location, 'license.md'), licenseText)
  return {
    name,
    version,
    licenses: [{ license: { id: 'MIT' } }],
    externalReferences: [{ type: 'vcs', url: 'https://github.com/example/upstream.git' }],
    properties: [{ name: 'cdx:npm:package:path', value: location }],
  }
}

test('missing package license uses an identical upstream version with explicit provenance', () => fixture(dir => {
  const source = upstreamPkg(dir, 'next', '1.0.0', 'UPSTREAM-LICENSE-TEXT')
  const target = upstreamPkg(dir, '@next/env', '1.0.0', null)
  source.externalReferences = []
  const sourcePackage = path.join(dir, source.properties[0].value, 'package.json')
  fs.writeFileSync(sourcePackage, JSON.stringify({ name: 'next', version: '1.0.0', license: 'MIT', repository: 'example/upstream' }))
  const out = generate(dir, [source, target])
  assert.match(out, /### @next\/env@1\.0\.0[\s\S]*Source : next@1\.0\.0\/license\.md[\s\S]*UPSTREAM-LICENSE-TEXT/)
}))

test('a README Licensing section is retained when no license file is shipped', () => fixture(dir => {
  const target = upstreamPkg(dir, 'native-package', '1.0.0', null)
  const location = target.properties[0].value
  fs.writeFileSync(path.join(dir, location, 'README.md'), '# Native\n\n## Licensing\n\nTHIRD-PARTY-LICENSE-TABLE\n')
  const out = generate(dir, [target])
  assert.match(out, /Source : native-package@1\.0\.0\/README\.md, section Licensing/)
  assert.match(out, /THIRD-PARTY-LICENSE-TABLE/)
}))

test('generated notices normalize upstream CRLF and trailing whitespace only', () => fixture(dir => {
  const target = pkg(dir, 'node_modules/fixture', '1.0.0', 'LICENSE-LINE-1  \r\n  LICENSE-LINE-2\t\r\n')
  const out = generate(dir, [target])
  assert.equal(out.includes('\r'), false)
  assert.doesNotMatch(out, /[ \t]\n/)
  assert.match(out, /LICENSE-LINE-1\n  LICENSE-LINE-2/)
}))

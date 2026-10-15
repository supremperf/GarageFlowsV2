'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { assess } = require('../scripts/audit-ci.js')
const braces = require('../vendor/braces-bounded')

test('audit rejects every severity and missing/error/inconsistent service responses', () => {
  const zero = { low: 0, moderate: 0, high: 0, critical: 0, info: 0, total: 0 }
  assert.equal(assess({ metadata: { vulnerabilities: zero }, vulnerabilities: {} }).ok, true)
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    assert.equal(assess({ metadata: { vulnerabilities: { ...zero, [severity]: 1, total: 1 } }, vulnerabilities: { fixture: { severity } } }).ok, false)
  }
  for (const report of [{}, { error: { code: 'NETWORK' } }, { metadata: { vulnerabilities: zero } }, { metadata: { vulnerabilities: zero }, vulnerabilities: { fixture: {} } }]) assert.equal(assess(report).ok, false)
})
test('bounded braces retains compile, parse, stringify, ranges and ordinary glob behavior', () => {
  assert.deepEqual(braces('a/{b,c}'), ['a/(b|c)'])
  assert.deepEqual(braces.expand('a/{b,c}/{1..3}'), ['a/b/1', 'a/b/2', 'a/b/3', 'a/c/1', 'a/c/2', 'a/c/3'])
  assert.equal(braces.stringify(braces.parse('a/{b,c}')), 'a/{b,c}')
  assert.equal(braces.compile('a/{b,{c,d}}'), 'a/(b|(c|d))')
  assert.deepEqual(braces.expand('x/{a,a,b}', { nodupes: true }), ['x/a', 'x/b'])
})
test('bounded braces rejects nesting, caller-crafted cyclic ASTs and oversized expansions before process exhaustion', () => {
  for (const input of ['{'.repeat(4000) + 'x' + '}'.repeat(4000), '('.repeat(4000) + 'x' + ')'.repeat(4000)]) {
    assert.throws(() => braces(input), /safety limit/)
  }
  const cycle = { type: 'root', nodes: [] }; cycle.nodes.push(cycle)
  for (const operation of ['compile', 'stringify', 'expand']) assert.throws(() => braces[operation](cycle), /safety limits/)
  assert.throws(() => braces.expand('{1..999999999}', { rangeLimit: false }), /range limit/)
  assert.throws(() => braces.expand('{a,b}'.repeat(15)), /safety limit/)
})
test('Electron builder can consume the upgraded downloader in CommonJS on the supported Node runtime', () => {
  const builderRequire = require('node:module').createRequire(require.resolve('app-builder-lib/package.json'))
  const get = builderRequire('@electron/get')
  assert.equal(typeof get.downloadArtifact, 'function')
  assert.equal(typeof get.initializeProxy, 'function')
  const downloaderRequire = require('node:module').createRequire(builderRequire.resolve('@electron/get'))
  const agent = downloaderRequire('global-agent')
  assert.equal(typeof agent.bootstrap, 'function')
  assert.equal(typeof agent.createGlobalProxyAgent, 'function')
  assert.doesNotThrow(() => require('app-builder-lib/out/util/electronGet.js'))
})
test('differential compatibility: 4653 outputs from pristine MIT upstream 3.0.3', () => {
  for (const item of require('./fixtures/braces-upstream.json')) {
    if (item.error) assert.throws(() => braces[item.operation](item.input, item.options), { name: item.error })
    else assert.deepEqual(braces[item.operation](item.input, item.options), item.result, JSON.stringify(item))
  }
})
test('descending, Unicode, unsafe-number and stepped compile ranges cannot evade limits', () => {
  for (const input of ['{999999999..0}', '{0..999999999..2}', '{9007199254740992..9007199254740996}', '{\u0000..\uffff}']) {
    for (const operation of ['expand', 'compile']) assert.throws(() => braces[operation](input), /limit/)
  }
  const root = { type: 'root', nodes: [] }, node = { type: 'text', value: 'x' }; node.parent = node; root.nodes.push(node)
  assert.throws(() => braces.expand(root), /parent chain/)
  assert.throws(() => braces.expand('{a,b}'.repeat(10) + 'x'.repeat(9000)), /safety limit/)
})
test('Nodemailer retains Promise/MIME transport API without contacting an SMTP service', async () => {
  const transport = require('nodemailer').createTransport({ jsonTransport: true })
  const info = await transport.sendMail({ from: 'garage@example.invalid', to: 'client@example.invalid', subject: 'Réparation', text: 'Devis prêt' })
  const message = JSON.parse(info.message)
  assert.equal(message.subject, 'Réparation')
  assert.equal(message.text, 'Devis prêt')
})
test('Sharp loads its actual platform binary and encodes/decodes PNG assets', async () => {
  const sharp = require('sharp')
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#102030ff' } }).png().toBuffer()
  const metadata = await sharp(png).metadata()
  assert.equal(metadata.width, 32)
  assert.equal(metadata.format, 'png')
})
test('arrays of patterns cannot evade the aggregate output budget', () => {
  assert.throws(() => braces(Array(11).fill('{a,b}'.repeat(10)), { expand: true }), /aggregate output/)
})

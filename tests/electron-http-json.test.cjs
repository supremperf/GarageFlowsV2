'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const http = require('node:http')
const { requestJson, redirectTarget, MAX_JSON_BYTES } = require('../electron/http-json')
async function endpoint(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return 'http://127.0.0.1:' + server.address().port
}
test('keeps JSON, User-Agent and split UTF8 metadata intact', async t => {
  const url = await endpoint(t, (req, res) => {
    assert.equal(req.headers['user-agent'], 'fixture-agent')
    const bytes = Buffer.from(JSON.stringify({ name: 'Réparation 🚗' }))
    const cut = bytes.indexOf(Buffer.from('🚗')) + 1
    res.write(bytes.subarray(0, cut)); setImmediate(() => res.end(bytes.subarray(cut)))
  })
  assert.deepEqual(await requestJson(url, { headers: { 'User-Agent': 'fixture-agent' } }), { name: 'Réparation 🚗' })
  assert.equal(MAX_JSON_BYTES, 8 * 1024 * 1024)
})
test('POST preserves request data and authoritative HTTP status, with no redirect following', async t => {
  let calls = 0
  const url = await endpoint(t, (req, res) => {
    calls++; let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      assert.deepEqual(JSON.parse(raw), { fixture: 'request' })
      res.writeHead(503, { Location: '/do-not-follow' }); res.end(JSON.stringify({ ok: false, httpStatus: 200 }))
    })
  })
  assert.deepEqual(await requestJson(url, { method: 'POST', body: { fixture: 'request' } }), { ok: false, httpStatus: 503 })
  assert.equal(calls, 1)
})
test('rejects declared and chunked oversize responses instead of parsing truncation', async t => {
  const url = await endpoint(t, (req, res) => {
    if (req.url === '/length') res.setHeader('Content-Length', '500')
    res.end(JSON.stringify({ bytes: 'x'.repeat(300) }))
  })
  assert.equal(await requestJson(url + '/length', { maxBytes: 64 }), null)
  assert.equal(await requestJson(url, { maxBytes: 64 }), null)
})
test('an active slow response cannot keep the request alive past its total deadline', async t => {
  const url = await endpoint(t, (_req, res) => {
    res.write('{"fixture":"')
    const timer = setInterval(() => res.write('x'), 10)
    res.on('close', () => clearInterval(timer))
  })
  assert.equal(await requestJson(url, { timeoutMs: 100 }), null)
})
test('relative GET redirects are supported with a fixed hop budget', async t => {
  const url = await endpoint(t, (req, res) => {
    if (req.url === '/first') { res.writeHead(302, { Location: '/final' }); res.end() }
    else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end() }
    else res.end('{"ok":true}')
  })
  assert.deepEqual(await requestJson(url + '/first'), { ok: true })
  assert.equal(await requestJson(url + '/loop', { maxRedirects: 2 }), null)
})
test('redirect chain shares one deadline rather than resetting it on every hop', async t => {
  const url = await endpoint(t, (req, res) => {
    const n = Number(req.url.slice(1))
    setTimeout(() => { if (res.destroyed) return; if (n < 5) { res.writeHead(302, { Location: '/' + (n + 1) }); res.end() } else res.end('{"ok":true}') }, 40)
  })
  assert.equal(await requestJson(url + '/0', { timeoutMs: 100, maxRedirects: 20 }), null)
})
test('malformed JSON and interrupted responses resolve null, never partial success', async t => {
  const url = await endpoint(t, (req, res) => {
    if (req.url === '/cut') { res.writeHead(200, { 'Content-Length': '500' }); res.write('{'); setImmediate(() => res.destroy()) }
    else res.end('not-json')
  })
  assert.equal(await requestJson(url), null)
  assert.equal(await requestJson(url + '/cut'), null)
})
test('redirect policy rejects invalid protocols and HTTPS downgrades', () => {
  assert.equal(redirectTarget('/next', 'https://fixture.invalid/start'), 'https://fixture.invalid/next')
  assert.equal(redirectTarget('http://fixture.invalid/next', 'https://fixture.invalid/start'), null)
  for (const bad of ['file:///tmp/file', 'javascript:alert(1)', 'data:text/plain,x']) assert.equal(redirectTarget(bad, 'https://fixture.invalid'), null)
})
test('invalid options and circular request bodies resolve null without making a request', async () => {
  const circular = {}; circular.self = circular
  assert.equal(await requestJson('not-url'), null)
  assert.equal(await requestJson('https://fixture.invalid', { method: 'POST', body: circular }), null)
  assert.equal(await requestJson('https://fixture.invalid', { timeoutMs: -1 }), null)
})

test('chunk overhead is bounded as well as bytes (deterministic real-module transport fixture)', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), { EventEmitter } = require('node:events')
  const fake = { get(_url, _options, received) {
    const req = new EventEmitter(); req.destroy = () => {}
    process.nextTick(() => {
      const res = new EventEmitter(); res.headers = {}; res.statusCode = 200; res.destroy = () => {}
      received(res)
      for (const piece of ['[', '0', ']']) res.emit('data', Buffer.from(piece))
      res.complete = true; res.emit('end')
    })
    return req
  } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/http-json.js'), 'utf8'), { module, require: () => fake, Buffer, URL, setTimeout, clearTimeout })
  assert.equal(await module.exports.requestJson('http://fixture.invalid', { maxBytes: 100, maxChunks: 2 }), null)
})

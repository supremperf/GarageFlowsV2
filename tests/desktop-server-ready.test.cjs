'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http'), crypto = require('node:crypto')
const { waitForHealth } = require('../electron/server-ready')
const key = 'fixture-only-startup-key-'.repeat(3)
async function serve(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return server.address().port
}
function body(req, overrides = {}) {
  return { app: 'garageflows', ok: true, db: 'connected', startupProof: crypto.createHmac('sha256', key).update('GF_DESKTOP_STARTUP_V1|' + req.headers['x-gf-startup-challenge']).digest('hex'), ...overrides }
}
test('readiness proves the owned process and real healthy DB, not merely an open port', async t => {
  const port = await serve(t, (req, res) => res.end(JSON.stringify(body(req))))
  assert.equal(await waitForHealth({ port, expectedKey: key, timeoutMs: 500 }), 200)
})
for (const variant of ['foreign', 'unhealthy', 'forged-proof', 'hang']) {
  test('bounded failure on ' + variant, async t => {
    const port = await serve(t, (req, res) => {
      if (variant === 'hang') return
      if (variant === 'unhealthy') res.statusCode = 503
      res.end(JSON.stringify(body(req, variant === 'foreign' ? { app: 'other' } : variant === 'forged-proof' ? { startupProof: '0'.repeat(64) } : {})))
    })
    await assert.rejects(waitForHealth({ port, expectedKey: key, timeoutMs: 150, requestTimeoutMs: 40, intervalMs: 15 }))
  })
}
test('utility-process exit aborts startup without waiting for its full deadline', async t => {
  const port = await serve(t, () => {})
  const signal = new AbortController()
  const promise = waitForHealth({ port, expectedKey: key, signal: signal.signal, timeoutMs: 1000 })
  signal.abort()
  await assert.rejects(promise, /arrêté/)
})

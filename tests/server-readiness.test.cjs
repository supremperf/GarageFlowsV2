'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { waitForGarageFlowsServer } = require('../electron/server-readiness')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

test('waits through ECONNREFUSED until GarageFlows health identity becomes available', async t => {
  const reservation = http.createServer()
  const port = await listen(reservation)
  await close(reservation)

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ app: 'garageflows' }))
  })
  const opening = setTimeout(() => server.listen(port, '127.0.0.1'), 100)
  t.after(async () => { clearTimeout(opening); if (server.listening) await close(server) })

  const status = await waitForGarageFlowsServer({ port, timeoutMs: 1_500, intervalMs: 20 })
  assert.equal(status, 200)
})

test('never accepts an unrelated process occupying the app port', async t => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ app: 'not-garageflows' }))
  })
  const port = await listen(server)
  t.after(() => close(server))

  await assert.rejects(
    waitForGarageFlowsServer({ port, timeoutMs: 90, intervalMs: 10 }),
    /occupé par une autre application/,
  )
})

test('recognizes GarageFlows even when its health check reports degraded dependencies', async t => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ app: 'garageflows', ok: false }))
  })
  const port = await listen(server)
  t.after(() => close(server))

  assert.equal(await waitForGarageFlowsServer({ port, timeoutMs: 500 }), 503)
})

test('rejects an unreachable port at the deadline instead of treating startup as successful', async () => {
  const reservation = http.createServer()
  const port = await listen(reservation)
  await close(reservation)

  await assert.rejects(
    waitForGarageFlowsServer({ port, timeoutMs: 70, intervalMs: 10 }),
    /ne répond pas sur le port/,
  )
})

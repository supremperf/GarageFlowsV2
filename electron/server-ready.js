'use strict'
const http = require('node:http')
const crypto = require('node:crypto')
/** One request at a time, a bounded body, and an independent total deadline. */
function waitForHealth({ port, timeoutMs = 35000, requestTimeoutMs = 2000, intervalMs = 400, expectedKey, signal }) {
  if (typeof expectedKey !== 'string' || expectedKey.length < 32) return Promise.reject(new Error('Startup proof key unavailable'))
  return new Promise((resolve, reject) => {
    let done = false, request, retry, foreign = false
    const challenge = crypto.randomBytes(16).toString('hex')
    const expectedProof = crypto.createHmac('sha256', expectedKey).update('GF_DESKTOP_STARTUP_V1|' + challenge).digest('hex')
    const abort = () => finish(new Error('Le service interne s’est arrêté pendant son démarrage.'))
    const deadline = setTimeout(() => finish(new Error(foreign
      ? `Le port ${port} est occupé par une autre application.`
      : 'Le service interne GarageFlows n’est pas devenu disponible dans le délai prévu.')), timeoutMs)
    function finish(error, value) {
      if (done) return
      done = true
      clearTimeout(deadline); clearTimeout(retry)
      signal?.removeEventListener('abort', abort)
      if (request) request.destroy()
      error ? reject(error) : resolve(value)
    }
    function again() { if (!done) { clearTimeout(retry); retry = setTimeout(check, intervalMs) } }
    function check() {
      if (done) return
      request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: requestTimeoutMs, headers: { 'x-gf-startup-challenge': challenge } }, response => {
        let text = '', bytes = 0
        response.setEncoding('utf8')
        response.on('data', chunk => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > 16384) { response.destroy(); request.destroy(); return }
          text += chunk
        })
        response.on('error', again)
        response.on('end', () => {
          let health
          try { health = JSON.parse(text) } catch { /* retry until deadline */ }
          if (health?.app !== 'garageflows') foreign = true
          if (response.statusCode === 200 && health?.app === 'garageflows' && health.ok === true && health.db === 'connected' && typeof health.startupProof === 'string' && /^[a-f0-9]{64}$/.test(health.startupProof) && crypto.timingSafeEqual(Buffer.from(health.startupProof, 'hex'), Buffer.from(expectedProof, 'hex'))) {
            finish(null, response.statusCode)
          } else again()
        })
      })
      request.on('timeout', () => request.destroy())
      request.on('error', again)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    else check()
  })
}
module.exports = { waitForHealth }

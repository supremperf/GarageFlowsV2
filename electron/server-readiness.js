'use strict'

const http = require('node:http')

/**
 * Attend que le port local réponde avec l'identité de NOTRE application.
 * Les refus de connexion transitoires sont normaux pendant le démarrage ; ils
 * sont retentés jusqu'à l'échéance. En revanche, un autre serveur sur le port
 * ne sera jamais considéré comme prêt.
 */
function waitForGarageFlowsServer({
  port,
  hostname = '127.0.0.1',
  timeoutMs = 30_000,
  intervalMs = 400,
  requestTimeoutMs = 2_000,
  httpModule = http,
  onForeignServer = () => {},
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new TypeError('port invalide'))
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError('timeoutMs invalide'))
  }

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let settled = false
    let sawForeignServer = false
    let retryTimer = null
    let activeRequest = null

    const finish = (error, statusCode) => {
      if (settled) return
      settled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (error && activeRequest) activeRequest.destroy()
      activeRequest = null
      if (error) reject(error)
      else resolve(statusCode)
    }

    const retry = () => {
      if (settled) return
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        finish(new Error(sawForeignServer
          ? `Le port ${port} est occupé par une autre application. Fermez-la puis relancez GarageFlows.`
          : `Le serveur GarageFlows ne répond pas sur le port ${port} après ${timeoutMs / 1000}s.`))
        return
      }
      retryTimer = setTimeout(probe, Math.min(intervalMs, remaining))
    }

    const probe = () => {
      if (settled) return
      if (Date.now() >= deadline) return retry()

      let responseReceived = false
      try {
        const req = httpModule.get({ hostname, port, path: '/api/health' }, res => {
          responseReceived = true
          let body = ''
          res.setEncoding('utf8')
          res.on('data', chunk => {
            // The health response is tiny. Bound untrusted responses from a
            // process that happens to occupy the local port.
            if (body.length + chunk.length > 16_384) {
              res.destroy()
              return
            }
            body += chunk
          })
          res.on('end', () => {
            if (settled) return
            let identity = null
            try { identity = JSON.parse(body).app } catch (_) { /* not our endpoint */ }
            if (identity === 'garageflows') {
              finish(null, res.statusCode ?? 0)
              return
            }
            if (!sawForeignServer) {
              sawForeignServer = true
              try { onForeignServer() } catch (_) { /* logging must not block startup */ }
            }
            retry()
          })
          res.on('error', retry)
        })
        activeRequest = req
        req.setTimeout(Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())), () => {
          req.destroy(new Error('sonde serveur expirée'))
        })
        req.on('error', () => {
          // A refused connection simply means Next.js has not bound its port
          // yet. Retry until the overall deadline instead of failing open.
          if (!responseReceived) retry()
        })
      } catch (_) {
        retry()
      }
    }

    probe()
  })
}

module.exports = { waitForGarageFlowsServer }

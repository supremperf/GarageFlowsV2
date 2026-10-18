'use strict'
const http = require('node:http')
const https = require('node:https')
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_JSON_CHUNKS = 65536

function redirectTarget(location, current) {
  try {
    const from = new URL(current), to = new URL(location, from)
    if (!['http:', 'https:'].includes(to.protocol)) return null
    if (from.protocol === 'https:' && to.protocol !== 'https:') return null
    return to.toString()
  } catch { return null }
}

/** Bounded metadata transport. No retries and never throws to its caller.
 * The limit applies to RESPONSES only, not request payloads or binary downloads.
 */
function requestJson(url, { method = 'GET', body, headers = {}, timeoutMs = 6000,
  maxBytes = MAX_JSON_BYTES, maxChunks = MAX_JSON_CHUNKS, maxRedirects = 5 } = {}) {
  if (!['GET', 'POST'].includes(method) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxChunks) || maxChunks <= 0 ||
      !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) return Promise.resolve(null)
  return new Promise(resolve => {
    let done = false, request, response
    let data
    try { data = method === 'POST' ? JSON.stringify(body) : undefined } catch { resolve(null); return }
    if (method === 'POST' && data === undefined) { resolve(null); return }
    // Independent of socket activity: slow/chunked servers cannot extend this.
    const deadline = setTimeout(() => finish(null), timeoutMs)
    function finish(value) {
      if (done) return
      done = true
      clearTimeout(deadline)
      response?.destroy()
      request?.destroy()
      resolve(value)
    }
    function start(current, redirects) {
      if (done) return
      let parsed
      try { parsed = new URL(current) } catch { finish(null); return }
      if (!['http:', 'https:'].includes(parsed.protocol)) { finish(null); return }
      const transport = parsed.protocol === 'https:' ? https : http
      let retired = false
      const received = res => {
        if (done) { res.destroy(); return }
        response = res
        if (method === 'GET' && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const target = redirectTarget(res.headers.location, current)
          retired = true
          res.destroy()
          if (!target || redirects >= maxRedirects) { finish(null); return }
          start(target, redirects + 1)
          return
        }
        const length = res.headers['content-length']
        if (length && /^\d+$/.test(length) && Number(length) > maxBytes) { finish(null); return }
        const chunks = []
        let bytes = 0, count = 0
        res.on('data', chunk => {
          if (done) return
          bytes += chunk.length; count++
          if (bytes > maxBytes || count > maxChunks) { finish(null); return }
          chunks.push(chunk)
        })
        res.on('aborted', () => finish(null))
        res.on('error', () => finish(null))
        res.on('end', () => {
          if (done) return
          try {
            const json = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
            finish(method === 'POST' ? { ...json, httpStatus: res.statusCode } : json)
          } catch { finish(null) }
        })
        res.on('close', () => { if (!res.complete) finish(null) })
      }
      try {
        if (method === 'GET') {
          // Retain the GET URL/UA contract; do not add any Authorization header.
          request = transport.get(parsed, { headers, timeout: timeoutMs }, received)
        } else {
          // Match the existing POST contract: userinfo is not converted to Basic
          // auth, redirects are not followed, and the real HTTP status wins.
          request = transport.request({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search, method, timeout: timeoutMs,
            headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, received)
        }
        request.on('error', () => { if (!retired) finish(null) })
        request.on('timeout', () => { if (!retired) finish(null) })
        if (method === 'POST') request.end(data)
      } catch { finish(null) }
    }
    start(url, 0)
  })
}
module.exports = { requestJson, redirectTarget, MAX_JSON_BYTES, MAX_JSON_CHUNKS }

'use strict'
// Read-only diagnostic: names/presence, versions, DNS, and public HTTPS HEAD. No keys/DSNs or TLS bypass.
const https = require('node:https')
const dns = require('node:dns').promises
const fs = require('node:fs')
const path = require('node:path')
async function head(host) {
  return new Promise(resolve => {
    let tlsEstablished = false
    const req = https.request({ hostname: host, path: host === 'registry.npmjs.org' ? '/prisma' : '/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/schema-engine.sha256', method: 'HEAD' }, res => {
      res.resume(); resolve({ host, httpStatus: res.statusCode, tlsEstablished, tlsAuthorized: res.socket.authorized })
    })
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('deadline'), { code: 'DIAGNOSTIC_TIMEOUT' })), 5000)
    req.on('socket', socket => socket.on('secureConnect', () => { tlsEstablished = true }))
    req.on('error', e => resolve({ host, errorCode: e.code || e.name, tlsEstablished, httpStatus: null }))
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}
;(async () => {
  const presence = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PRISMA_ENGINES_MIRROR', 'PRISMA_QUERY_ENGINE_LIBRARY', 'PRISMA_SCHEMA_ENGINE_BINARY'].map(k => [k, !!process.env[k]]))
  const hosts = ['binaries.prisma.sh', 'registry.npmjs.org']
  const lookup = await Promise.all(hosts.map(async host => { try { return { host, addresses: await dns.lookup(host, { all: true }) } } catch (e) { return { host, errorCode: e.code } } }))
  const report = { at: new Date().toISOString(), node: process.version, nodeOpenSSL: process.versions.openssl, platform: process.platform, arch: process.arch,
    prismaVersion: require('prisma/package.json').version, clientVersion: require('@prisma/client/package.json').version,
    engineCommit: require('@prisma/engines-version').enginesVersion, settingPresence: presence,
    engineFilesPresent: fs.readdirSync(path.dirname(require.resolve('@prisma/engines/package.json'))).filter(n => /schema-engine|libquery_engine|query-engine/.test(n)),
    dns: lookup, https: await Promise.all(hosts.map(head)),
    limits: 'Public endpoints only. No private configuration loaded, no binaries installed/executed, no TLS verification disabled. A pre-TLS reset does not prove certificate invalidity. Diagnosis failure remains nonzero.' }
  console.log(JSON.stringify(report, null, 2))
  if (report.https.some(r => r.httpStatus !== 200)) process.exitCode = 1
})().catch(e => { console.error(e.code || e.name); process.exitCode = 1 })

'use strict'
// Component test of the INSTALLED standalone, using CI's Node as an inspection
// tool. This is NOT a claim that the licensed Electron business UI was opened.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto'), net = require('node:net')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { waitForHealth } = require('../electron/server-ready')
async function main() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.GF_WINDOWS_SMOKE_ISOLATED !== '1') throw new Error('Disposable Windows CI required')
  const install = process.argv[2], dbPath = process.argv[3]
  if (!install || !dbPath) throw new Error('Installed path and disposable DB required')
  const standalone = path.join(install, 'resources', 'standalone'), photos = path.join(path.dirname(dbPath), 'photos')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-installed-server-'))
  const proofKey = crypto.randomBytes(32).toString('hex')
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  // Guard module resolution: even if build tools exist on the runner, the
  // installed server cannot borrow JS/native modules from the checkout.
  const guard = path.join(temp, 'guard.cjs')
  fs.writeFileSync(guard, `const M=require('node:module'),p=require('node:path');const base=${JSON.stringify(standalone)};const original=M._resolveFilename;M._resolveFilename=function(...args){const f=original.apply(this,args);if(p.isAbsolute(f)){const r=p.relative(base,f);if(r.startsWith('..')||p.isAbsolute(r))throw Error('Module outside installed payload');}return f;};`)
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare('INSERT INTO Garage (id,name,slug,updatedAt) VALUES (?,?,?,?)').run('setup-smoke-garage', 'Setup fixture', 'setup-smoke-fixture', Date.now())
    db.prepare('INSERT INTO Client (id,name,garageId,updatedAt) VALUES (?,?,?,?)').run('setup-smoke-client', 'Setup fixture client', 'setup-smoke-garage', Date.now())
  } finally { db.close() }
  const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, NODE_PATH: '', NODE_OPTIONS: '',
    PORT: String(port), HOSTNAME: '127.0.0.1', ELECTRON: '1', NODE_ENV: 'production',
    NEXTAUTH_URL: `http://localhost:${port}`, DATABASE_URL: 'file:' + dbPath.replace(/\\/g, '/'),
    NEXTAUTH_SECRET: crypto.randomBytes(32).toString('hex'), GF_DB_MAC_SECRET: crypto.randomBytes(32).toString('hex'),
    GF_INTERNAL_EXPORT_KEY: proofKey, GF_PHOTOS_DIR: photos }
  const child = spawn(process.execPath, ['--require', guard, path.join(standalone, 'server.js')], { cwd: standalone, env, stdio: 'ignore', windowsHide: true })
  const report = { success: false, stage: 'startup', runtime: 'CI Node against installed standalone (not licensed Electron UI)', modulesRestrictedToInstalledPayload: true }
  let spawnFailed = false
  child.on('error', () => { spawnFailed = true })
  const base = `http://127.0.0.1:${port}`, headers = { 'x-internal-key': proofKey, 'Content-Type': 'application/json' }
  try {
    await waitForHealth({ port, expectedKey: proofKey, timeoutMs: 60000 })
    if (spawnFailed) throw new Error('Installed server spawn failed')
    report.stage = 'internal-auth'
    if ((await fetch(base + '/api/internal/export')).status !== 401) throw new Error('Internal API did not reject missing key')
    report.stage = 'sqlite-export'
    const exported = await fetch(base + '/api/internal/export', { headers })
    if (exported.status !== 200 || !(await exported.json()).clients.some(c => c.id === 'setup-smoke-client')) throw new Error('Installed SQLite/export failed')
    report.stage = 'sqlite-backup'
    const destination = path.join(path.dirname(dbPath), 'backups', 'setup-smoke.db')
    const response = await fetch(base + '/api/internal/backup', { method: 'POST', headers, body: JSON.stringify({ destination }) })
    if (response.status !== 200 || !fs.existsSync(destination)) throw new Error('Installed backup API failed')
    const backup = new DatabaseSync(destination, { readOnly: true })
    try { if (backup.prepare('SELECT id FROM Client WHERE id=?').get('setup-smoke-client')?.id !== 'setup-smoke-client') throw new Error('Backup lacks the committed fixture') }
    finally { backup.close() }
    report.stage = 'static'
    if (!(await fetch(base + '/manifest.webmanifest')).ok) throw new Error('Installed public assets unavailable')
    report.stage = 'sqlite-migrations'
    const migrated = await fetch(base + '/api/internal/migrate', { method: 'POST', headers, body: '{}' })
    if (migrated.status !== 200 || !(await migrated.json()).ok) throw new Error('Installed SQLite migration API failed')
    report.stage = 'complete'; report.success = true
  } finally {
    child.kill()
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 10000).unref() })
    fs.rmSync(temp, { recursive: true, force: true })
    const evidence = path.join(__dirname, '..', 'artifacts/windows-delivery')
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'installed-server.json'), JSON.stringify(report, null, 2) + '\n')
    console.log('::notice title=Installed standalone component test::' + JSON.stringify(report))
  }
}
main().catch(() => { console.error('Installed standalone component test failed; see stage in receipt, no raw credentials logged.'); process.exitCode = 1 })

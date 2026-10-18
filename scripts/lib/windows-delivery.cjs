'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { refuseLinkedPath } = require('./package-prisma-resources.cjs')
const INSTALLER_NAME = 'GarageFlows-Setup.exe'
function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256'), stream = fs.createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
function peInfo(file, minimum = 20 * 1024 * 1024) {
  refuseLinkedPath(file)
  const fd = fs.openSync(file, 'r')
  try {
    const stat = fs.fstatSync(fd), head = Buffer.alloc(64)
    if (!stat.isFile() || stat.size < minimum || fs.readSync(fd, head, 0, 64, 0) !== 64 || head.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Windows executable')
    const offset = head.readUInt32LE(60), pe = Buffer.alloc(6)
    if (offset < 64 || offset > 1024 * 1024 || offset + 6 > stat.size || fs.readSync(fd, pe, 0, 6, offset) !== 6 || pe.readUInt32LE(0) !== 0x4550) throw new Error('Invalid PE header')
    return { size: stat.size, machine: pe.readUInt16LE(4) }
  } finally { fs.closeSync(fd) }
}
function regularFiles(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name), full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Linked payload entry refused')
    if (entry.isDirectory()) out.push(...regularFiles(full, rel))
    else if (entry.isFile()) out.push(rel)
    else throw new Error('Non-regular payload entry refused')
  }
  return out.sort()
}
async function comparePayload(expected, extracted) {
  const a = regularFiles(expected), b = regularFiles(extracted)
  if (!a.length || JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Installer payload file inventory differs from win-unpacked')
  for (const rel of a) {
    if (await digest(path.join(expected, rel)) !== await digest(path.join(extracted, rel))) throw new Error('Installer payload content differs: ' + rel)
  }
  return a.length
}
async function inspectNsis(root, installer) {
  const unpacked = path.join(root, 'dist', 'win-unpacked')
  if (peInfo(path.join(unpacked, 'GarageFlows.exe')).machine !== 0x8664) throw new Error('Application payload is not Windows x64')
  // Both resource tree and ASAR must be free of publisher-only tools/state.
  const forbidden = /(^|\/)(?:keygen(?:_[^/]*)?\.py|licenses_db\.json|server_config\.json|private[^/]*\.(?:pem|key)|\.env(?:\.[^/]*)?)$/i
  const asar = require('@electron/asar')
  const entries = [...regularFiles(unpacked), ...asar.listPackage(path.join(unpacked, 'resources', 'app.asar'))]
  if (entries.some(entry => forbidden.test(entry.replace(/\\/g, '/')))) throw new Error('Publisher-only file or environment found in application payload')
  const sevenZip = await require('app-builder-lib/out/toolsets/7zip').getPath7za()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-nsis-inspect-'))
  function extract(archive, destination) {
    const run = spawnSync(sevenZip, ['x', '-y', '-o' + destination, archive], { encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024, timeout: 180000 })
    if (run.status !== 0 || run.error || run.signal) throw new Error('NSIS payload extraction failed; no successful inspection inferred')
  }
  try {
    const outer = path.join(temp, 'outer'), payload = path.join(temp, 'payload')
    extract(installer, outer)
    const archives = regularFiles(outer).filter(f => /(^|\/)app-64\.7z$/i.test(f))
    if (archives.length !== 1) throw new Error('A single embedded offline x64 payload is required (not nsis-web)')
    extract(path.join(outer, archives[0]), payload)
    return { payloadFiles: await comparePayload(unpacked, payload), payloadVerified: true, offlinePayloadEmbedded: true }
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
async function publish(root, verification) {
  if (!verification?.payloadVerified || !verification.offlinePayloadEmbedded) throw new Error('Actual NSIS inspection receipt required before delivery')
  const source = path.join(root, 'dist', INSTALLER_NAME), directory = path.join(root, 'release'), target = path.join(directory, INSTALLER_NAME)
  refuseLinkedPath(directory); refuseLinkedPath(target)
  fs.mkdirSync(directory, { recursive: true })
  if (fs.readdirSync(directory).some(name => name !== INSTALLER_NAME)) throw new Error('release contains foreign files; preserved, not deleted')
  const info = peInfo(source), sha256 = await digest(source)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.packageVersion !== pkg.version || !/^[a-f0-9]{40}$/.test(manifest.git?.commit || '')) throw new Error('Missing or stale build identity')
  const temp = path.join(directory, '.' + crypto.randomUUID() + '.tmp')
  try {
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL)
    if (await digest(temp) !== sha256) throw new Error('Delivery copy digest mismatch')
    fs.renameSync(temp, target)
  } finally { fs.rmSync(temp, { force: true }) }
  const receipt = { schema: 1, file: 'release/' + INSTALLER_NAME, version: pkg.version, commit: manifest.git.commit, dirty: !!manifest.git.dirty, size: info.size, sha256, platform: 'win32', arch: 'x64', ...verification,
    authenticodeVerified: false, cleanMachineLicensedBusinessWorkflowVerified: false }
  const evidence = path.join(root, 'artifacts', 'windows-delivery')
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, 'delivery.json'), JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}
module.exports = { INSTALLER_NAME, digest, peInfo, regularFiles, comparePayload, inspectNsis, publish }

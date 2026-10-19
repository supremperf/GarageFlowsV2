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
/**
 * Diagnose a candidate executable WITHOUT throwing, so the caller can name the
 * exact defect and its remedy.
 *
 * Why this exists: `verify-installer.cjs` documents that it names, one by one,
 * an installer from a previous version, "une archive vide ou tronquée
 * (téléchargement/copie interrompue)", a file that is not a Windows executable
 * and an installer built from an incomplete standalone output. But the size and
 * header checks lived only inside `peInfo()`, which throws — and that throw
 * escaped `main()` before the problem list was ever assembled. A truncated copy
 * (the single most common way a Setup reaches a customer: an interrupted
 * download) was therefore reported as a bare "Invalid Windows executable", with
 * no size, no threshold and no next step. The promised diagnosis existed in the
 * docstring only.
 *
 * Returns `{ ok: true, size, machine }`, or `{ ok: false, code, message }` with
 * a stable code: ABSENT · UNREADABLE · NOT_A_FILE · EMPTY · TRUNCATED_SIZE ·
 * NOT_MZ · PE_OFFSET_OUT_OF_RANGE · BAD_PE_SIGNATURE · SHORT_READ.
 *
 * `minimum` is the delivery threshold, not a validity threshold: a file below it
 * is still parsed, so a genuine 40 Ko stub is reported as TRUNCATED_SIZE with
 * both numbers rather than as an unexplained rejection.
 */
function describePe(file, minimum = 20 * 1024 * 1024) {
  const fail = (code, message) => ({ ok: false, code, message })
  let fd = null
  try {
    refuseLinkedPath(file)
  } catch (error) {
    return fail('UNREADABLE', `chemin refusé (${error.message})`)
  }
  try {
    fd = fs.openSync(file, 'r')
  } catch (error) {
    return fail(error.code === 'ENOENT' ? 'ABSENT' : 'UNREADABLE',
      error.code === 'ENOENT' ? 'fichier absent' : `lecture impossible (${error.code || 'erreur'})`)
  }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return fail('NOT_A_FILE', 'ce n’est pas un fichier régulier')
    if (stat.size === 0) return fail('EMPTY', 'fichier vide (0 octet)')
    const head = Buffer.alloc(64)
    if (fs.readSync(fd, head, 0, 64, 0) !== 64 && stat.size >= 64) return fail('SHORT_READ', 'en-tête illisible')
    if (head.toString('ascii', 0, 2) !== 'MZ') return fail('NOT_MZ', 'signature MZ absente — ce n’est pas un exécutable Windows')
    const offset = head.readUInt32LE(60)
    if (offset < 64 || offset > 1024 * 1024) return fail('PE_OFFSET_OUT_OF_RANGE', `offset d’en-tête PE hors bornes (${offset})`)
    const pe = Buffer.alloc(6)
    if (offset + 6 > stat.size || fs.readSync(fd, pe, 0, 6, offset) !== 6) {
      return fail('TRUNCATED_SIZE',
        `tronqué à ${stat.size} octets : l’en-tête PE annoncé à l’offset ${offset} dépasse la fin du fichier`)
    }
    if (pe.readUInt32LE(0) !== 0x4550) return fail('BAD_PE_SIGNATURE', 'signature PE absente à l’offset déclaré')
    if (stat.size < minimum) {
      return fail('TRUNCATED_SIZE',
        `${stat.size} octets, sous le minimum de ${minimum} octets attendu d’un installeur complet`)
    }
    return { ok: true, size: stat.size, machine: pe.readUInt16LE(4) }
  } catch (error) {
    return fail('UNREADABLE', `inspection impossible (${error.code || error.message})`)
  } finally {
    if (fd !== null) { try { fs.closeSync(fd) } catch (_) {} }
  }
}

/**
 * Same inspection, but as a hard refusal: an installer that cannot be parsed is
 * never delivered. Kept throwing because `inspectNsis()` and `publish()` must
 * stop the chain — and because a caller that only wants a verdict should not
 * have to branch on a code. The precise cause from `describePe()` is now carried
 * in the message instead of being flattened into one generic sentence.
 */
function peInfo(file, minimum = 20 * 1024 * 1024) {
  const verdict = describePe(file, minimum)
  if (!verdict.ok) {
    throw new Error(verdict.code === 'NOT_MZ' || verdict.code === 'EMPTY' || verdict.code === 'NOT_A_FILE'
      || verdict.code === 'ABSENT' || verdict.code === 'UNREADABLE' || verdict.code === 'SHORT_READ'
      ? `Invalid Windows executable — ${verdict.message}`
      : `Invalid PE header — ${verdict.message}`)
  }
  return { size: verdict.size, machine: verdict.machine }
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
    // Some 7za toolsets detect the embedded 7z SFX stream directly rather
    // than exposing the surrounding NSIS plugin files. Still compare EVERY
    // extracted application file; a mere MZ/file-count check is not sufficient.
    if (fs.existsSync(path.join(outer, 'GarageFlows.exe')) && fs.existsSync(path.join(outer, 'resources', 'app.asar'))) {
      return { payloadFiles: await comparePayload(unpacked, outer), payloadVerified: true, offlinePayloadEmbedded: true, extractionMode: 'embedded-7z-sfx' }
    }
    // NSIS variable paths need not retain their original archive filename.
    const archives = regularFiles(outer).filter(f => {
      const fd = fs.openSync(path.join(outer, f), 'r'), magic = Buffer.alloc(6)
      try { return fs.readSync(fd, magic, 0, 6, 0) === 6 && magic.toString('hex') === '377abcaf271c' }
      finally { fs.closeSync(fd) }
    })
    if (archives.length !== 1) throw new Error('Expected exactly one embedded offline payload; extracted entries: ' + JSON.stringify(regularFiles(outer).slice(0, 24)))
    extract(path.join(outer, archives[0]), payload)
    return { payloadFiles: await comparePayload(unpacked, payload), payloadVerified: true, offlinePayloadEmbedded: true, extractionMode: 'nsis-archive' }
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
module.exports = { INSTALLER_NAME, digest, describePe, peInfo, regularFiles, comparePayload, inspectNsis, publish }

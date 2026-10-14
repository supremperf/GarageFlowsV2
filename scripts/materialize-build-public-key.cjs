#!/usr/bin/env node
'use strict'
// Restores ONLY the already-pinned PUBLIC build resource. This is not an
// independent check of the publisher's external signing authority, nor rotation.
const fs = require('node:fs')
const path = require('node:path')
const { createPublicKey, createHash } = require('node:crypto')
function fingerprint(pem) {
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Expected public SPKI key')
  return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}
function embedded(root, file, name) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const block = text.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!block) throw new Error('Public anchor missing; materialization refused')
  return [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n') + '\n'
}
function materializePublicKey(root) {
  const electron = embedded(root, 'electron/main.js', '_PK')
  const server = embedded(root, 'src/lib/license/public-key.ts', '_LINES')
  const expected = fs.readFileSync(path.join(root, 'src/lib/license/__tests__/public-key-consistency.test.ts'), 'utf8')
    .match(/const\s+REFERENCE_FP\s*=\s*'([0-9a-f]{64})'/)?.[1]
  if (!expected || fingerprint(electron) !== expected || fingerprint(server) !== expected) {
    throw new Error('Public anchors disagree; no key file written')
  }
  const directory = path.join(root, 'keys'), target = path.join(directory, 'public.pem')
  if (!fs.existsSync(directory)) fs.mkdirSync(directory)
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Refusing non-directory key path')
  try { fs.writeFileSync(target, electron, { flag: 'wx', mode: 0o644 }); return 'created' }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (!fs.lstatSync(target).isFile() || fingerprint(fs.readFileSync(target, 'utf8')) !== expected) {
      throw new Error('Existing public key differs; preserved without modification')
    }
    return 'unchanged'
  }
}
module.exports = { materializePublicKey }
if (require.main === module) {
  try {
    console.log('Public build resource:', materializePublicKey(path.resolve(__dirname, '..')))
    console.log('Embedded anchors checked; external signing authority NOT independently verified.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

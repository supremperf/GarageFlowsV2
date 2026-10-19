#!/usr/bin/env node
'use strict'
// Auto-load only the publisher key PATH and keyId; never copy a private key into this repo.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { assertExternalFile, publicFingerprint } = require('./config-services.cjs')
const root = path.resolve(__dirname, '..')
async function main() {
  const args = process.argv.slice(2)
  const config = path.join(root, 'GarageFlow-configuration/publisher.json')
  if (!args.includes('--help') && !args.includes('--gen-key') && fs.existsSync(config) &&
    !process.env.GF_UPDATE_SIGNING_KEY && !process.env.GF_UPDATE_SIGNING_KEY_FILE) {
    const publisher = JSON.parse(fs.readFileSync(config, 'utf8'))
    const keyFile = assertExternalFile(root, publisher.keyFile)
    const publicKeys = require('../electron/update-verify.js').PUBLIC_KEYS
    const requestedId = args.includes('--key-id') ? args[args.indexOf('--key-id') + 1] : publisher.keyId
    if (!publicKeys[requestedId] || publicFingerprint(fs.readFileSync(keyFile)) !== publicFingerprint(publicKeys[requestedId])) {
      throw new Error('Publication : keyId incompatible avec le coffre et les clés publiques embarquées.')
    }
    process.env.GF_UPDATE_SIGNING_KEY_FILE = keyFile
    if (!args.includes('--key-id')) process.argv.push('--key-id', publisher.keyId)
  }
  await import(pathToFileURL(path.join(root, 'scripts/sign-release-manifest.mjs')).href)
}
main().catch(() => { console.error('Signature : configuration du coffre invalide ou illisible. Aucun contenu secret affiché. Relancer config.'); process.exitCode = 1 })

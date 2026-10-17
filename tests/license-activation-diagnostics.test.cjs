'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const script = fs.readFileSync(path.join(__dirname, '../scripts/reset-garageflow.ps1'), 'utf8')

test('deployment reset does not inject activation secrets or raw exceptions into logs', () => {
  assert.doesNotMatch(script, /hasPrivateKey|serializeActivationError|erreur DB complète/)
  assert.match(script, /Activation route left unchanged; sensitive diagnostics are not injected/)
})

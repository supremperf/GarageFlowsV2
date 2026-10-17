'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
test('legacy PowerShell API-key probe stays blocking and never sends a credential', () => {
  const src = fs.readFileSync('scripts/configurer-api-garageflow.ps1', 'utf8')
  const body = src.split('function Test-ApiKeyEndpoint {')[1].split('function Invoke-ProjectCommand {')[0]
  assert.match(body, /return \$false/)
  assert.match(body, /REVOCATION_ADMIN_RUNBOOK/)
  assert.doesNotMatch(body, /Invoke-WebRequest|Invoke-RestMethod|x-gf-key|return \$true/)
})

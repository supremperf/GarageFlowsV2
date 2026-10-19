#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
let python = 'python'
let max = '20'
try {
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'GarageFlow-configuration/keygen-runtime.json'), 'utf8'))
  if (['python3', 'python', 'py'].includes(runtime.python)) python = runtime.python
} catch { /* The system Python launcher is the documented fallback. */ }
try {
  const server = JSON.parse(fs.readFileSync(path.join(root, 'keys/server_config.json'), 'utf8'))
  if (Number.isSafeInteger(server.max_mechanic) && server.max_mechanic > 0) max = String(server.max_mechanic)
} catch { /* A first-time keygen still starts with its safe default cap. */ }
const args = process.argv.slice(2)
const script = args.length ? 'keygen.py' : 'keygen_ui.py'
const child = spawn(python, [path.join(root, 'scripts', script), ...args], {
  cwd: root, env: { ...process.env, GF_KEYGEN_MAX_MECHANIC: max }, shell: false, stdio: 'inherit',
})
child.once('error', () => { console.error('Keygen : Python indisponible. Exécuter config ou installer Python >=3.10 + cryptography.'); process.exitCode = 1 })
child.once('close', code => { process.exitCode = code === 0 ? 0 : 1 })

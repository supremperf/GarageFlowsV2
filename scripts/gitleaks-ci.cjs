'use strict'
// Preserve the official scan and its exit status. Publish ONLY location metadata,
// never Secret, Match, entropy, snippets or child process output.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
function escapeProperty(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}
function locations(report, commit) {
  // Official v8.24.3 JsonReporter encodes a nil findings slice as JSON null.
  if (report === null) report = []
  if (!Array.isArray(report)) throw new Error('Invalid scanner report')
  return report.map(finding => {
    if (!finding || typeof finding.RuleID !== 'string' || typeof finding.File !== 'string' ||
        !Number.isSafeInteger(finding.StartLine) || finding.StartLine < 1 ||
        !Number.isSafeInteger(finding.EndLine) || finding.EndLine < finding.StartLine) {
      throw new Error('Invalid scanner location')
    }
    return { rule: finding.RuleID, path: finding.File, startLine: finding.StartLine,
      endLine: finding.EndLine, commit, scope: 'working-tree', status: 'EN ATTENTE DE REVUE' }
  })
}
function run({ spawn = cp.spawnSync, cwd = process.cwd(), commit = process.env.GITHUB_SHA || '',
  emit = line => console.log(line) } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'garageflows-gitleaks-'))
  fs.chmodSync(temporary, 0o700)
  const report = path.join(temporary, 'redacted.json')
  let exit = 2
  try {
    const result = spawn('gitleaks', ['dir', '.', '--config', '.gitleaks.toml', '--redact',
      '--no-banner', '--report-format', 'json', '--report-path', report], {
      cwd, encoding: 'utf8', timeout: 540000, maxBuffer: 16 * 1024 * 1024,
      // Do not inherit output: even diagnostic context must not expose values.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error || result.signal || !Number.isInteger(result.status)) {
      emit('::error::Gitleaks could not complete; child output intentionally withheld.')
      return 2
    }
    exit = result.status
    if (![0, 1].includes(exit)) {
      emit(`::error::Gitleaks execution failed (exit ${exit}); child output intentionally withheld.`)
      return exit
    }
    const rows = locations(JSON.parse(fs.readFileSync(report, 'utf8')), commit)
    if ((exit === 0 && rows.length !== 0) || (exit === 1 && rows.length === 0)) {
      emit('::error::Gitleaks exit/report inconsistency; refusing success.')
      return 2
    }
    // Notices carry untriaged metadata, not a severity judgement. The original
    // exit 1 still fails the job and Required validation. Avoid per-step limits
    // on error annotations; consumers must reconcile annotation count vs total.
    for (const row of rows) {
      emit(`::notice file=${escapeProperty(row.path)},line=${row.startLine},endLine=${row.endLine},title=${escapeProperty('Gitleaks ' + row.rule)}::EN ATTENTE DE REVUE; scope=working-tree; commit=${escapeData(row.commit)}`)
    }
    emit(`Gitleaks location metadata: ${rows.length} findings; scanner exit ${exit}. No secret values published.`)
    return exit
  } catch {
    emit('::error::Unable to validate Gitleaks location report; details intentionally withheld.')
    return 2
  } finally {
    // Only this process's private temporary directory, never a user fixture.
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}
module.exports = { run, locations, escapeData, escapeProperty }
if (require.main === module) process.exitCode = run()

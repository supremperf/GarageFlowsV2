'use strict'
// Diagnostic transport only. The official command and its nonzero exit remain
// mandatory. Never upload raw logs, environment values, keys or signed URLs.
const { spawnSync } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { deflateSync } = require('node:zlib')

function redact(text, environment = process.env) {
  let safe = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  for (const [name, value] of Object.entries(environment)) {
    if (/(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|API_KEY)/i.test(name) && typeof value === 'string' && value.length >= 8) {
      safe = safe.split(value).join('[ENV_SECRET_REDACTED]')
    }
  }
  return safe
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[PRIVATE_KEY_REDACTED]')
    .replace(/\b(?:https?|postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{12,}/g, '[TOKEN_REDACTED]')
    .replace(/\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*[^\s,;"'}]+/gi, '[LABELED_SECRET_REDACTED]')
}
function exitCode(result) {
  return Number.isInteger(result.status) ? result.status : 1
}
function diagnostic(result, environment = process.env) {
  const raw = String(result.stdout ?? '') + '\n' + String(result.stderr ?? '')
  const safe = redact(raw, environment)
  const tail = safe.slice(-10_000)
  const metadata = {
    schema: 1, command: 'npm run dist', platform: process.platform, node: process.version,
    exitCode: exitCode(result), signal: result.signal ?? null,
    spawnErrorCode: result.error?.code ?? null,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    sanitizedCharacters: safe.length, tailCharacters: tail.length,
    completeSanitizedLog: tail.length === safe.length,
    log: tail,
  }
  const payload = deflateSync(Buffer.from(JSON.stringify(metadata))).toString('base64')
  const count = Math.ceil(payload.length / 2000)
  if (count > 8) throw new Error('Diagnostic overflow')
  const pages = Array.from({ length: count }, (_, index) => ({
    page: index + 1, pages: count, encoding: 'deflate-base64', payload: payload.slice(index * 2000, (index + 1) * 2000),
  }))
  return { safe, pages, metadata }
}
function validateCommand(script) {
  if (String(script).replace(/^\uFEFF/, '').trim() !== 'npm run dist') throw new Error('Unsupported packaging command')
  return 'npm run dist'
}
function main() {
  if (process.platform !== 'win32') {
    console.error('Official Windows packaging requires Windows; not executed')
    process.exitCode = 1
    return
  }
  // GitHub custom shell receives its generated one-command script. Reject any
  // other script; never silently ignore added checks or execute external input.
  let command
  try {
    if (process.argv.length !== 3) throw new Error('Missing workflow script')
    command = validateCommand(require('node:fs').readFileSync(process.argv[2], 'utf8'))
  } catch {
    console.error('::error::Packaging command rejected; expected official one-command workflow script')
    process.exitCode = 1
    return
  }
  const result = spawnSync(command, {
    shell: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  try {
    const { safe, pages } = diagnostic(result)
    // Escape workflow-command injection; never echo raw child output.
    const marker = randomUUID()
    console.log('::stop-commands::' + marker)
    console.log(safe)
    console.log('::' + marker + '::')
    for (const page of pages) console.log('::notice title=Windows packaging diagnostic ' + page.page + '/' + page.pages + '::' + JSON.stringify(page))
  } catch {
    console.error('::error::Packaging diagnostic incomplete; raw output withheld')
    process.exitCode = exitCode(result) || 1
    return
  }
  process.exitCode = exitCode(result)
}
module.exports = { redact, exitCode, diagnostic, validateCommand }
if (require.main === module) main()

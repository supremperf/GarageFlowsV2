'use strict'

// Never persist raw provider errors, headers (including auth challenges), or
// stdout/stderr. Even error.code is untrusted: export only these fixed labels.
const HTTP_STATUS = Symbol('vercel-http-status')
const CODES = new Set([
  'challenge_required', 'challenge_required_email_otp', 'user_auth_required',
  'unauthorized', 'invalid_token', 'token_expired', 'forbidden', 'not_authorized',
  'permission_denied', 'not_found', 'bad_request', 'rate_limited',
  'sensitive_env_var_not_readable',
])
const CHALLENGES = new Set(['challenge_required', 'challenge_required_email_otp', 'user_auth_required'])
const REASONS = new Set([
  'auth_challenge', 'authentication_required', 'permission_denied', 'http_forbidden', 'not_found',
  'rate_limited', 'api_error', 'command_failed', 'invalid_json',
  'unexpected_response', 'incomplete_response', 'wrong_key', 'wrong_target',
  'not_decrypted', 'masked_value', 'missing_value',
])
function classify(status, code, fallback) {
  if (CHALLENGES.has(code)) return 'auth_challenge'
  if (status === 401 || ['unauthorized', 'invalid_token', 'token_expired'].includes(code)) return 'authentication_required'
  if (['forbidden', 'not_authorized', 'permission_denied'].includes(code)) return 'permission_denied'
  // HTTP 403 alone cannot distinguish RBAC from a stronger-auth challenge.
  if (status === 403) return 'http_forbidden'
  if (status === 404 || code === 'not_found') return 'not_found'
  if (status === 429 || code === 'rate_limited') return 'rate_limited'
  return fallback
}
function safeFailure(input = {}) {
  if (!input || typeof input !== 'object') input = {}
  const httpStatus = Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599 ? input.httpStatus : null
  const errorCode = CODES.has(input.errorCode) ? input.errorCode : null
  return {
    reason: classify(httpStatus, errorCode, REASONS.has(input.reason) ? input.reason : 'command_failed'),
    httpStatus, errorCode,
    cliExitCode: Number.isInteger(input.cliExitCode) ? input.cliExitCode : null,
  }
}
function failure(reason, extra = {}) {
  const error = new Error('Vercel : lecture non exploitable (détails filtrés).')
  error.vercelApi = safeFailure({ ...extra, reason })
  return error
}
function decode(output) {
  let text = String(output).trim(), httpStatus = null
  // `vercel api --include --raw` (CLI 64): HTTP <status> <reason>, headers,
  // blank line, JSON. Plain JSON remains supported by injectable test runners.
  if (/^HTTP(?:\/[\d.]+)?\s/.test(text)) {
    const header = text.match(/^HTTP(?:\/[\d.]+)?\s+(\d{3})[^\r\n]*(?:\r?\n[^\r\n]+)*\r?\n\r?\n/)
    if (!header) throw failure('unexpected_response')
    httpStatus = Number(header[1])
    text = text.slice(header[0].length)
  }
  let body
  try { body = JSON.parse(text) } catch { throw failure('invalid_json', { httpStatus }) }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw failure('unexpected_response', { httpStatus })
  if (body.error || httpStatus >= 400) throw failure('api_error', { httpStatus, errorCode: body.error?.code })
  Object.defineProperty(body, HTTP_STATUS, { value: httpStatus })
  return body
}
function status(body) { return body?.[HTTP_STATUS] ?? null }
function commandFailure(stdout, stderr, cliExitCode) {
  let details = { reason: 'command_failed' }
  try { decode(stdout) } catch (error) {
    // A failed command with no structured response is not a JSON/API failure.
    if (error.vercelApi?.httpStatus || error.vercelApi?.errorCode) details = error.vercelApi
  }
  // Some CLI failures are printed only on stderr. Recognize explicit status/
  // code fields, not arbitrary human messages; never retain the error text.
  const statuses = [...String(stderr).matchAll(/(?:\bHTTP(?:\/[\d.]+)?\s+|\bstatus(?:Code)?["':=\s]+|#\d+\s+←\s+)([45]\d{2})\b/gi)]
  const status = statuses.at(-1)
  const code = String(stderr).match(/["']?code["']?\s*[:=]\s*["']([a-z_]+)["']/)
  return safeFailure({ ...details, httpStatus: details.httpStatus || (status ? Number(status[1]) : null),
    errorCode: details.errorCode || code?.[1], cliExitCode })
}
module.exports = { decode, status, failure, safeFailure, commandFailure }

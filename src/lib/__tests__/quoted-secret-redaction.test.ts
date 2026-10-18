import { describe, it, expect } from 'vitest'
import { redactString, redactValue } from '../redact'
const { redactSensitive, sanitizeCrashReport } = require('../../../electron/control-plane.js')
// Public synthetic markers, never real credentials. Both production sinks tested.
const marker = 'SYNTHETIC_QUOTED_VALUE_9147'
const cases = [
  `password="${marker} with spaces"`,
  `password="${marker} truncated`,
  `token='${marker} dangling slash\\`,
  `token='${marker} with spaces'`,
  JSON.stringify({ password: marker, event: 'retained' }),
  JSON.stringify({ client_secret: `${marker} "escaped quote" tail` }),
  JSON.stringify({ Authorization: `Basic ${marker}` }),
  JSON.stringify({ Cookie: `session=${marker}; other=fixture` }),
  JSON.stringify({ 'Set-Cookie': `session=${marker}; HttpOnly` }),
  JSON.stringify({ GF_LICENSE_API_KEY: marker }),
  JSON.stringify({ GARAGEFLOW_CLIENT_SECRET: marker }),
  `GF_LICENSE_API_KEY="${marker}"`,
  `'refresh_token': '${marker}'`,
  JSON.stringify({ private_key: `${marker}\nsecond line` }),
]
describe.each([['Electron crash sink', redactSensitive], ['Next logger', redactString]] as const)('%s — quoted secrets', (_sink, redact) => {
  it.each(cases)('redacts %s', input => {
    const out = redact(input)
    expect(out).not.toContain(marker)
    expect(out).toContain('<redacted>')
  })
  it('retains unrelated JSON fields and valid JSON representation', () => {
    expect(JSON.parse(redact(JSON.stringify({ password: marker, event: 'retained', count: 4 })))).toEqual({ password: '<redacted>', event: 'retained', count: 4 })
  })
})
it('redacts environment-prefixed sensitive object keys recursively', () => {
  expect(redactValue({ GF_LICENSE_API_KEY: marker, nested: { DATABASE_PASSWORD: marker }, event: 'retained' })).toEqual({ GF_LICENSE_API_KEY: '<redacted>', nested: { DATABASE_PASSWORD: '<redacted>' }, event: 'retained' })
})
it('redacts all four transmitted crash text fields before truncation', () => {
  const text = JSON.stringify({ password: marker })
  const out = sanitizeCrashReport({ message: text, stack: text, logs: text, breadcrumbs: text })
  for (const field of ['message', 'stack', 'logs', 'breadcrumbs']) expect(out[field]).not.toContain(marker)
})
it('client and server produce identical redaction for common quoted-secret fixtures', () => {
  for (const input of cases) expect(redactSensitive(input)).toBe(redactString(input))
})

import { describe, it, expect } from 'vitest'
const cp = require('../../../electron/control-plane.js')

describe('control-plane — redaction des rapports de crash (RGPD)', () => {
  it('masque les mots de passe / tokens / clés API / secrets', () => {
    const s = cp.redactSensitive('password=hunter2 token=abc123 api_key=SECRETKEY client_secret=xyz')
    expect(s).not.toContain('hunter2')
    expect(s).not.toContain('abc123')
    expect(s).not.toContain('SECRETKEY')
    expect(s).not.toContain('xyz')
    expect(s).toMatch(/redacted/)
  })

  it("masque les en-têtes Authorization / cookies / Bearer", () => {
    expect(cp.redactSensitive('Authorization: Bearer eyJabc.def.ghi')).not.toContain('eyJabc')
    expect(cp.redactSensitive('Cookie: gf_session=secretcookievalue')).not.toContain('secretcookievalue')
  })

  it('masque les URLs de base de données avec identifiants', () => {
    const s = cp.redactSensitive('DATABASE_URL=postgresql://user:pass@host:5432/db')
    expect(s).not.toContain('user:pass')
    expect(s).toContain('<redacted>')
  })

  it("anonymise les chemins locaux contenant le nom d'utilisateur", () => {
    expect(cp.redactSensitive('C:\\Users\\JeanDupont\\AppData\\file.txt')).toContain('<user>')
    expect(cp.redactSensitive('C:\\Users\\JeanDupont\\AppData\\file.txt')).not.toContain('JeanDupont')
    expect(cp.redactSensitive('/home/jdupont/.config/app')).toContain('/<user>')
    expect(cp.redactSensitive('/home/jdupont/.config/app')).not.toContain('jdupont')
  })

  it('masque les tokens de licence GF2 et les JWT', () => {
    expect(cp.redactSensitive('lic GF2.aaa.bbb.ccc end')).toContain('GF2.<redacted>')
    expect(cp.redactSensitive('t=eyJhbGc.eyJwYXk.sig')).toContain('<jwt:redacted>')
  })

  it('ne lève jamais et gère les entrées vides', () => {
    expect(cp.redactSensitive(null)).toBe('')
    expect(cp.redactSensitive(undefined)).toBe('')
    expect(cp.redactSensitive(12345)).toBe('12345')
  })

  it('sanitizeCrashReport : jamais de HWID brut, tailles bornées, liste blanche', () => {
    const out = cp.sanitizeCrashReport({
      hwid: 'f'.repeat(64),
      message: 'boom password=secret',
      stack: 'x'.repeat(30000),
      logs: 'Authorization: Bearer abc.def.ghi',
      unknownField: 'should be dropped',
    })
    expect(out.hwid).not.toBe('f'.repeat(64)) // haché/tronqué
    expect(out.hwid.length).toBeLessThanOrEqual(16)
    expect(out.message).not.toContain('secret')
    expect(out.stack.length).toBeLessThanOrEqual(20000)
    expect(out.logs).not.toContain('abc.def.ghi')
    expect('unknownField' in out).toBe(false) // liste blanche
    expect(out.consent).toBe(true)
  })
})

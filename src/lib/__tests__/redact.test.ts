import { describe, it, expect } from 'vitest'
import { redactString, redactValue } from '../redact'

describe('redactString — motifs sensibles', () => {
  it('masque les tokens Bearer et JWT', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi')).toContain('<redacted>')
    expect(redactString('token eyJhbGci.payloadpart.sigpart')).toContain('<jwt:redacted>')
  })

  it('masque les paires clé=valeur sensibles', () => {
    expect(redactString('password=Sup3rSecret!')).toBe('password=<redacted>')
    expect(redactString('NEXTAUTH_SECRET=abcdef1234567890')).toMatch(/<redacted>/)
  })

  it('masque les URLs de base de données avec identifiants', () => {
    expect(redactString('postgresql://user:pass@host:5432/db')).toBe('postgresql://<redacted>')
  })

  it('masque les tokens de licence GF2', () => {
    expect(redactString('lic GF2.aaa.bbb.ccc used')).toContain('GF2.<redacted>')
  })

  it('tronque un HWID / SHA-256 (64 hex) en empreinte courte', () => {
    const hwid = 'a'.repeat(64)
    const out = redactString(`hwid=${hwid}`)
    expect(out).not.toContain(hwid)
    expect(out).toContain('aaaaaaaaaaaa…<redacted>')
  })

  it('anonymise les chemins utilisateur', () => {
    expect(redactString('C:\\Users\\Jean\\file')).toContain('\\Users\\<user>')
    expect(redactString('/home/marie/x')).toContain('/home/<user>')
  })
})

describe('redactValue — objets/erreurs', () => {
  it('masque la valeur des clés sensibles', () => {
    const out = redactValue({ password: 'x', token: 'y', name: 'Alice', gf_session: 'jwt' }) as Record<string, unknown>
    expect(out.password).toBe('<redacted>')
    expect(out.token).toBe('<redacted>')
    expect(out.gf_session).toBe('<redacted>')
    expect(out.name).toBe('Alice')
  })

  it('redacte récursivement + gère les Error sans lever', () => {
    const out = redactValue({ nested: { secret: 's', ok: 1 } }) as any
    expect(out.nested.secret).toBe('<redacted>')
    expect(out.nested.ok).toBe(1)
    const e = redactValue(new Error('Bearer abc.def.ghi')) as any
    expect(e.message).toContain('<redacted>')
  })

  it('laisse passer les valeurs non sensibles', () => {
    expect(redactValue('hello world')).toBe('hello world')
    expect(redactValue(42)).toBe(42)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { authSecret, authSecretKey } from '@/lib/auth-secret'

const ORIGINAL = process.env.NEXTAUTH_SECRET

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = ORIGINAL
})

describe('authSecret', () => {
  it('renvoie le secret quand il est présent et suffisamment long', () => {
    process.env.NEXTAUTH_SECRET = 'a'.repeat(32)
    expect(authSecret()).toBe('a'.repeat(32))
  })

  it('échoue si le secret est absent', () => {
    delete process.env.NEXTAUTH_SECRET
    expect(() => authSecret()).toThrow(/NEXTAUTH_SECRET/)
  })

  it('échoue si le secret est trop court (< 16)', () => {
    process.env.NEXTAUTH_SECRET = 'short'
    expect(() => authSecret()).toThrow(/absent ou trop court/)
  })

  it('authSecretKey renvoie un Uint8Array encodant le secret', () => {
    process.env.NEXTAUTH_SECRET = 'x'.repeat(20)
    const key = authSecretKey()
    expect(key).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(key)).toBe('x'.repeat(20))
  })
})

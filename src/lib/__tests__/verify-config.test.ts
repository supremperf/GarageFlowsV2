import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => 'not-a-valid-pem' }))

import { verifyLicenseToken } from '@/lib/license/verify'

describe('verifyLicenseToken — configuration errors', () => {
  it('invalid public key is reported as verifier misconfiguration, not an invalid licence', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'GF-LIC', v: 2 })).toString('base64url')
    const payload = Buffer.from('{}').toString('base64url')
    const result = verifyLicenseToken(`GF2.${header}.${payload}.signature`)
    expect(result.valid).toBe(false)
    expect(result.failure).toBe('misconfigured')
    expect(result.reason).not.toContain('invalide ou modifiée')
  })
})

import { describe, expect, it } from 'vitest'
import { API_ERROR_STATUS, classifyServerFailure, isDatabaseUnavailableError, ServerMisconfiguredError } from '@/lib/errors/apiErrors'

describe('API dependency error policy', () => {
  it('keeps database outages separate from license authorization', () => {
    expect(API_ERROR_STATUS.DB_UNAVAILABLE).toBe(503)
    expect(API_ERROR_STATUS.LICENSE_INVALID).toBe(403)
  })

  it('keeps missing runtime configuration distinct from license errors', () => {
    expect(classifyServerFailure(new ServerMisconfiguredError('NEXTAUTH_SECRET'))).toEqual({
      code: 'SERVER_MISCONFIGURED', status: 500,
    })
  })

  it('recognizes Prisma wrapped Closed errors', () => {
    expect(isDatabaseUnavailableError({
      name: 'PrismaClientUnknownRequestError',
      cause: { kind: 'Closed' },
    })).toBe(true)
  })

  it('recognizes known Prisma connection/pool codes', () => {
    expect(isDatabaseUnavailableError({ code: 'P2024' })).toBe(true)
    expect(isDatabaseUnavailableError({ code: 'P1001' })).toBe(true)
  })

  it('does not classify license, validation, or arbitrary application errors as outages', () => {
    expect(isDatabaseUnavailableError(new Error('invalid signature'))).toBe(false)
    expect(isDatabaseUnavailableError({ code: 'P2002', message: 'unique constraint' })).toBe(false)
    expect(isDatabaseUnavailableError(null)).toBe(false)
  })
})

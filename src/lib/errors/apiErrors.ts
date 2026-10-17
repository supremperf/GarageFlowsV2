/**
 * API error policy shared by Node.js route handlers.
 *
 * Keep infrastructure failures distinct from authorization failures: a database
 * outage must never be presented as an invalid license/device.
 */
export type ApiErrorCode =
  | 'LICENSE_INVALID'
  | 'DEVICE_NOT_REGISTERED'
  | 'DB_UNAVAILABLE'
  | 'SERVER_MISCONFIGURED'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'

export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  LICENSE_INVALID: 403,
  DEVICE_NOT_REGISTERED: 403,
  DB_UNAVAILABLE: 503,
  SERVER_MISCONFIGURED: 500,
  AUTH_REQUIRED: 401,
  RATE_LIMITED: 429,
}

/** Typed marker for missing/invalid runtime configuration. Never includes values. */
export class ServerMisconfiguredError extends Error {
  readonly code = 'SERVER_MISCONFIGURED' as const

  constructor(readonly variableName: string) {
    super(`Required server configuration is invalid: ${variableName}`)
    this.name = 'ServerMisconfiguredError'
  }
}

/** Stable, typed marker for a dependency outage. Never includes driver details. */
export class DbUnavailableError extends Error {
  readonly code = 'DB_UNAVAILABLE' as const

  constructor() {
    super('Database dependency unavailable')
    this.name = 'DbUnavailableError'
  }
}

const DB_ERROR_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])

/**
 * Recognize Prisma connection/pool failures without treating arbitrary errors
 * as license failures. Handles Prisma's wrapped `{ kind: 'Closed' }` causes.
 */
export function isServerMisconfiguredError(error: unknown): boolean {
  return error instanceof ServerMisconfiguredError ||
    (typeof error === 'object' && error !== null &&
      (error as { code?: unknown }).code === 'SERVER_MISCONFIGURED')
}

export function classifyServerFailure(error: unknown): {
  code: 'DB_UNAVAILABLE' | 'SERVER_MISCONFIGURED' | 'INTERNAL_ERROR'
  status: 503 | 500
} {
  if (isServerMisconfiguredError(error)) return { code: 'SERVER_MISCONFIGURED', status: 500 }
  if (isDatabaseUnavailableError(error)) return { code: 'DB_UNAVAILABLE', status: 503 }
  return { code: 'INTERNAL_ERROR', status: 500 }
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  const pending: unknown[] = [error]
  const seen = new Set<object>()
  let visited = 0

  while (pending.length && visited++ < 32) {
    const value = pending.pop()
    if (!value || typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.add(value)

    const item = value as Record<string, unknown>
    if (typeof item.code === 'string' && DB_ERROR_CODES.has(item.code)) return true
    if (item.kind === 'Closed') return true

    const message = typeof item.message === 'string' ? item.message : ''
    if (/\b(?:connection|database|pool)\b.{0,80}\b(?:closed|timeout|timed out|unavailable|exhausted|refused|reset)\b/i.test(message)) {
      return true
    }

    for (const key of ['cause', 'meta', 'originalError', 'error']) {
      const nested = item[key]
      if (nested && typeof nested === 'object') pending.push(nested)
    }
  }
  return false
}

/**
 * Shared guard for the Electron-only internal endpoints (`/api/internal/*`).
 *
 * These endpoints are protected by the `X-Internal-Key` header, compared
 * constant-time against `GF_INTERNAL_EXPORT_KEY`. Fail-closed: if the server key
 * is not configured, every request is rejected (never implicitly authorized).
 */
import { constantTimeEqual } from '@/lib/secure-compare'

export function isInternalKeyValid(headerKey: string | null | undefined): boolean {
  const serverKey = process.env.GF_INTERNAL_EXPORT_KEY?.trim()
  if (!serverKey) return false
  const provided = headerKey?.trim()
  return !!provided && constantTimeEqual(provided, serverKey)
}

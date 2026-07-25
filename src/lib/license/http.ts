/**
 * Shared HTTP helpers for the license routes: admin gate (rate-limit + auth),
 * JSON body reading, and uniform error shapes. Node runtime only.
 */
import { NextResponse } from 'next/server'
import { requireLicenseAdmin, clientIp } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Rate-limit + authorize an admin license request.
 * Returns `{ ip }` on success, or a ready-to-return NextResponse on failure.
 */
export async function adminGate(req: Request): Promise<{ ip: string } | NextResponse> {
  const ip = clientIp(req) ?? 'local'
  if (!rateLimit(`lic-admin:${ip}`, 60, 60).ok) {
    return NextResponse.json({ error: 'Trop de requêtes. Réessayez plus tard.' }, { status: 429 })
  }
  const auth = await requireLicenseAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return { ip }
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status })
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

export function serviceError(err: unknown): NextResponse {
  console.error('[license] unexpected error:', (err as { code?: string })?.code ?? (err as Error)?.message ?? 'unknown')
  return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
}

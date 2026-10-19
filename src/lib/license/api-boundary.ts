import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { licenseFailure } from './failures'
import { logger } from '@/lib/logger'

/** Une seule frontière pour TOUT le handler, y compris auth et limiteur. Jamais de stack/secret. */
export async function licenseApiBoundary(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run()
  } catch (error) {
    const { code, status } = licenseFailure(error)
    const requestId = randomUUID()
    logger.error('[license-api] échec technique', { code, requestId })
    return NextResponse.json({
      ok: false, code, requestId,
      reason: code === 'SERVER_MISCONFIGURED'
        ? 'Configuration du service indisponible. Contactez le support.'
        : 'Vérification temporairement indisponible. Réessayez plus tard.',
    }, { status, headers: { 'X-Request-ID': requestId, ...(status === 503 ? { 'Retry-After': '60' } : {}) } })
  }
}

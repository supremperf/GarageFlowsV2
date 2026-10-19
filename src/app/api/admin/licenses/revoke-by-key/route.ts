export const dynamic = 'force-dynamic'

/**
 * Retiré : une clé partagée ne constitue pas une authentification admin forte.
 * Fermeture permanente, y compris si un ancien flag/secret est présent.
 * Aucun flag ne réactive cette route. Utiliser les routes admin de session
 * existantes après validation opérationnelle, jamais cet ancien point d'entrée.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/logger'
import { clientIpFrom } from '@/lib/security/rate-limit'

export async function POST(req: NextRequest) {
  const requestId = randomUUID() // Ne pas faire confiance à un ID fourni par le client.
  // Aucun corps/en-tête d'authentification ni identifiant de licence journalisé.
  // Ce journal doit être collecté vers le SIEM avec rétention et accès restreint.
  logger.warn('[admin-security] endpoint retiré', {
    requestId,
    ip: clientIpFrom(req),
    userAgent: (req.headers.get('user-agent') ?? '').replace(/[\r\n\x00-\x1f]/g, '').slice(0, 256),
    actor: 'unauthenticated',
    timestamp: new Date().toISOString(),
    action: 'revoke-by-key.denied',
    outcome: 'disabled',
  })
  // Aucun appel DB ni limiteur requis : même une panne du limiteur ne peut ouvrir une écriture.
  return NextResponse.json({ ok: false, code: 'ENDPOINT_DISABLED', requestId }, {
    status: 404, headers: { 'X-Request-ID': requestId, 'Cache-Control': 'no-store' },
  })
}

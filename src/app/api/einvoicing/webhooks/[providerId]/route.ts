export const dynamic = 'force-dynamic'

/**
 * POST /api/einvoicing/webhooks/[providerId] — réception d'un webhook de
 * plateforme agréée.
 *
 * ─── Pourquoi cette route est PUBLIQUE ──────────────────────────────────────
 * Une plateforme agréée n'a ni session GarageFlows ni licence : elle POSTE un
 * événement depuis ses serveurs. L'authentification est donc la SIGNATURE HMAC
 * du corps brut, vérifiée avec le secret de la connexion du garage concerné
 * (voir `webhook-signature.ts`). Sans signature valide, aucun statut n'est
 * modifié.
 *
 * ─── Ce que la route expose ─────────────────────────────────────────────────
 * · 404 si la transmission est inconnue — une plateforme doit cesser de
 *   réessayer un identifiant qu'elle n'a jamais émis ;
 * · 409 si la connexion n'a pas de secret configuré, ou si l'identifiant
 *   externe est ambigu entre plusieurs garages ;
 * · 401 si la signature est absente, fausse ou hors de la fenêtre de 5 min ;
 * · 413 au-delà de 64 Kio ;
 * · 200 pour un événement appliqué, ignoré (régression) ou déjà traité.
 *
 * Aucun corps d'erreur ne reprend la charge utile ni le secret.
 */

import { NextResponse } from 'next/server'
import { isPostgresDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { TAILLE_MAX_WEBHOOK, traiterWebhook } from '@/lib/einvoicing/webhook'

export async function POST(
  req: Request,
  { params: pendingParams }: { params: Promise<{ providerId: string }> },
) {
  // Les modèles d'e-facturation n'existent qu'en PostgreSQL. Sur un poste, la
  // route n'existe pas : 404 plutôt qu'une erreur Prisma opaque.
  if (!isPostgresDatabase()) {
    return NextResponse.json({ ok: false, code: 'SERVER_ONLY' }, { status: 404 })
  }

  if (!getEInvoicingFlags().enabled) {
    return NextResponse.json({ ok: false, code: 'EINVOICING_DISABLED' }, { status: 409 })
  }

  // Un webhook est une porte publique : on la borne par IP avant toute lecture
  // de corps, comme les autres points d'entrée anonymes.
  const rl = await enforceRateLimit('license_status', `einvoice-webhook:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  const { providerId } = await pendingParams
  if (!providerId || providerId.length > 64) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  let corpsBrut: string
  try {
    corpsBrut = await req.text()
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (Buffer.byteLength(corpsBrut, 'utf8') > TAILLE_MAX_WEBHOOK) {
    return NextResponse.json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
  }

  const entetes = {
    'x-gf-signature': req.headers.get('x-gf-signature') ?? undefined,
    'x-gf-timestamp': req.headers.get('x-gf-timestamp') ?? undefined,
    'x-gf-event-id': req.headers.get('x-gf-event-id') ?? undefined,
  }

  try {
    const resultat = await traiterWebhook({ providerId, corpsBrut, entetes })
    return NextResponse.json(
      {
        ok: resultat.ok,
        ...(resultat.code ? { code: resultat.code } : {}),
        ...(resultat.status ? { status: resultat.status } : {}),
        ...(resultat.duplicate ? { duplicate: true } : {}),
        ...(resultat.ignored ? { ignored: true } : {}),
      },
      { status: resultat.http },
    )
  } catch (err) {
    // Aucun détail interne au client : la plateforme réessaiera, et l'erreur
    // reste dans nos journaux d'exploitation.
    logger.error('[einvoicing/webhook] traitement impossible', err)
    return NextResponse.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

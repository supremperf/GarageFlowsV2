export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/einvoicing/queue — reprise des transmissions en échec.
 *
 * ─── Qui appelle cette route ────────────────────────────────────────────────
 * Une tâche planifiée de l'exploitant (cron Vercel, planificateur système),
 * jamais un navigateur. Aucun écran ne la déclenche : une reprise est un acte
 * automatique, tracé comme tel (`actorUserId: null`).
 *
 * ─── Authentification ───────────────────────────────────────────────────────
 * Jeton dédié `EINVOICING_QUEUE_TOKEN` (≥ 32 caractères), transmis en
 * `Authorization: Bearer …`, comparaison à temps constant. Aucun repli sur une
 * autre clé, aucune valeur par défaut : sans jeton configuré, la route répond
 * 503 et ne fait rien. Elle est en outre fermée quand la fonctionnalité
 * d'émission est désactivée.
 *
 * ─── Ce que la route ne fera JAMAIS ─────────────────────────────────────────
 * · reprendre une transmission `unknown` ou abandonnée (la plateforme a
 *   peut-être reçu la facture : décision humaine) ;
 * · reprendre une transmission `rejected` (contenu refusé : le renvoyer tel
 *   quel produirait le même refus) ;
 * · dépasser cinq tentatives automatiques (voir `queue.ts`).
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { isPostgresDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { traiterFile } from '@/lib/einvoicing/queue'

/** Longueur minimale du jeton : en dessous, la route refuse de s'ouvrir. */
const LONGUEUR_MIN_TOKEN = 32
const LIMITE_MAX = 50

function jetonValide(req: Request): { ok: boolean; raison?: 'NOT_CONFIGURED' | 'UNAUTHORIZED' } {
  const attendu = process.env.EINVOICING_QUEUE_TOKEN ?? ''
  if (attendu.length < LONGUEUR_MIN_TOKEN) return { ok: false, raison: 'NOT_CONFIGURED' }

  const entete = req.headers.get('authorization') ?? ''
  const m = entete.match(/^Bearer\s+(.+)$/i)
  if (!m) return { ok: false, raison: 'UNAUTHORIZED' }

  const recu = Buffer.from(m[1].trim())
  const reference = Buffer.from(attendu)
  if (recu.length !== reference.length) return { ok: false, raison: 'UNAUTHORIZED' }
  return crypto.timingSafeEqual(recu, reference) ? { ok: true } : { ok: false, raison: 'UNAUTHORIZED' }
}

export async function POST(req: Request) {
  if (!isPostgresDatabase()) {
    return NextResponse.json({ ok: false, code: 'SERVER_ONLY' }, { status: 404 })
  }
  const flags = getEInvoicingFlags()
  if (!flags.enabled || !flags.outgoingEnabled) {
    return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED' }, { status: 409 })
  }

  const auth = jetonValide(req)
  if (!auth.ok) {
    if (auth.raison === 'NOT_CONFIGURED') {
      return NextResponse.json(
        { ok: false, code: 'QUEUE_NOT_CONFIGURED' },
        { status: 503 },
      )
    }
    logger.warn('[einvoicing/queue] jeton refusé')
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  // Limite optionnelle, bornée : un appelant ne doit pas pouvoir demander de
  // traiter mille factures d'un coup et monopoliser le serveur.
  let limite = 20
  try {
    const body = (await req.json()) as { limit?: unknown }
    if (Number.isSafeInteger(body?.limit)) {
      limite = Math.min(Math.max(body.limit as number, 1), LIMITE_MAX)
    }
  } catch {
    // Corps absent : la valeur par défaut s'applique.
  }

  try {
    const resultat = await traiterFile(limite)
    return NextResponse.json({ ok: true, ...resultat })
  } catch (err) {
    logger.error('[einvoicing/queue] traitement impossible', err)
    return NextResponse.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

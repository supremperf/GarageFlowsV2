export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/licenses/revoke-by-key
 *
 * Programmatic endpoint used by the keygen_gui.py admin tool to update
 * license status in real-time without a browser session.
 *
 * Auth: x-gf-key header must match GARAGEFLOW_API_KEY.
 * Body: { licenseId: string, status: 'active' | 'revoked' | 'suspended' }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { computeRecordMac } from '@/lib/license/record-mac'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

const VALID_STATUSES = ['active', 'revoked', 'suspended'] as const
type Status = typeof VALID_STATUSES[number]

/** Comparaison à temps constant (évite l'oracle de timing sur la clé API). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export async function POST(req: NextRequest) {
  // Défense en profondeur (§5 « administration : protection renforcée ») : limite
  // le débit AVANT toute comparaison — réduit la surface de brute-force sur la
  // clé API réseau-accessible (fail-closed en prod PWA si Upstash indisponible).
  const rl = await enforceRateLimit('admin', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  // Auth : compare x-gf-key à GARAGEFLOW_API_KEY (temps constant).
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''

  // Refuse une clé serveur absente OU trop faible (pas de contrôle d'accès mou).
  if (!serverApiKey || serverApiKey.length < 16) {
    console.error('[admin/licenses/revoke-by-key] GARAGEFLOW_API_KEY absente ou trop faible')
    return NextResponse.json(
      { error: 'Configuration serveur incomplète (GARAGEFLOW_API_KEY).' },
      { status: 500 }
    )
  }

  if (!apiKey || !safeEqual(apiKey, serverApiKey)) {
    return NextResponse.json(
      { error: 'Accès refusé — clé API invalide' },
      { status: 403 }
    )
  }

  let licenseId: string
  let status: Status

  try {
    const body = await req.json()

    licenseId = String(body.licenseId ?? '').trim()
    status = body.status as Status
    // SÉCURITÉ : ne jamais journaliser DATABASE_URL ni de secret. Trace minimale.
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête invalide' },
      { status: 400 }
    )
  }

  if (!licenseId) {
    return NextResponse.json(
      { error: 'licenseId manquant' },
      { status: 400 }
    )
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status invalide — valeurs autorisées : ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const record = await prisma.licenseKey.findUnique({
      where: { licenseId },
    })

    // Licence non encore enregistrée côté serveur
    if (!record) {
      if (status === 'active') {
        return NextResponse.json({
          ok: true,
          licenseId,
          status,
          note: 'not_registered',
        })
      }

      const expiryAt = new Date('2099-12-31T23:59:59.000Z')
      const token = `pending:${licenseId}`

      const tombMac = computeRecordMac({
        licenseId,
        token,
        status,
        expiryAt,
        hwid: null,
      })

      const created = await prisma.licenseKey.create({
        data: {
          licenseId,
          token,
          customerId: 'pending',
          licenseType: 'standard',
          expiryAt,
          status,
          revokedAt: status === 'revoked' ? new Date() : null,
          recordMac: tombMac,
          label:
            status === 'revoked'
              ? 'Révoquée avant activation'
              : 'Suspendue avant activation',
        },
      })

      return NextResponse.json({
        ok: true,
        created: true,
        licenseId: created.licenseId,
        status: created.status,
        label: created.label,
      })
    }

    const newMac = computeRecordMac({
      licenseId: record.licenseId,
      token: record.token,
      status,
      expiryAt: record.expiryAt,
      hwid: record.hwid ?? null,
    })

    const updated = await prisma.licenseKey.update({
      where: {
        id: record.id,
      },
      data: {
        status,
        revokedAt:
          status === 'revoked'
            ? new Date()
            : status === 'active'
            ? null
            : undefined,
        recordMac: newMac,
      },
    })

    return NextResponse.json({
      ok: true,
      licenseId: updated.licenseId,
      status: updated.status,
      label: updated.label,
    })
  } catch (err) {
    // Ne jamais renvoyer le message d'erreur brut (fuite d'infos internes).
    console.error('[admin/licenses/revoke-by-key] erreur base de données')
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}
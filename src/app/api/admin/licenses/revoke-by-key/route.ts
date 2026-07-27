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
import { prisma } from '@/lib/db'
import { computeRecordMac } from '@/lib/license/record-mac'
import { constantTimeEqual } from '@/lib/secure-compare'
import { logger } from '@/lib/logger'

const VALID_STATUSES = ['active', 'revoked', 'suspended'] as const
type Status = typeof VALID_STATUSES[number]

export async function POST(req: NextRequest) {
  // Auth : compare x-gf-key à GARAGEFLOW_API_KEY (constant-time)
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''

  if (!serverApiKey) {
    logger.error('[admin/licenses/revoke-by-key] GARAGEFLOW_API_KEY non configurée')
    return NextResponse.json(
      { error: 'Configuration serveur incomplète (GARAGEFLOW_API_KEY absente).' },
      { status: 500 }
    )
  }

  if (!apiKey || !constantTimeEqual(apiKey, serverApiKey)) {
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

      logger.info('[admin/licenses/revoke-by-key] license created before activation', {
        licenseId: created.licenseId,
        status: created.status,
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

    logger.info('[admin/licenses/revoke-by-key] license status updated', {
      licenseId: updated.licenseId,
      status: updated.status,
    })

    return NextResponse.json({
      ok: true,
      licenseId: updated.licenseId,
      status: updated.status,
      label: updated.label,
    })
  } catch (err) {
    // Log the detail server-side; never leak DB internals to the client.
    logger.error('[admin/licenses/revoke-by-key] DB error:', err)

    return NextResponse.json(
      { error: 'Erreur base de données' },
      { status: 500 }
    )
  }
}
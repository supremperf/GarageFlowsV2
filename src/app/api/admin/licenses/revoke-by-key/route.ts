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
import { checkAdminApiKey } from '@/lib/security/api-key'

const VALID_STATUSES = ['active', 'revoked', 'suspended'] as const
type Status = typeof VALID_STATUSES[number]

export async function POST(req: NextRequest) {
  // Auth: constant-time check of x-gf-key against LICENSE_ADMIN_API_KEY.
  const auth = checkAdminApiKey(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
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
          licenseType: 'trial',
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
  } catch (err: any) {
    console.error('[admin/licenses/revoke-by-key] DB error:', err?.code ?? err?.message ?? 'unknown')

    return NextResponse.json(
      {
        error: 'Erreur base de données',
      },
      { status: 500 }
    )
  }
}
export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/license-status — miroir LOCAL d'une décision de licence de
 * l'autorité DISTANTE. Protégée par X-Internal-Key (loopback uniquement).
 *
 * POURQUOI (GF-FINAL-001, P0) : quand l'admin révoque/suspend une licence sur
 * le control plane, la base SQLite du poste n'en savait rien. Dès que le
 * serveur distant devenait injoignable, le battement retombait sur le contrôle
 * LOCAL qui répondait « active » — et le blocage était levé. Cette route permet
 * au process Electron (seul détenteur de la clé interne) de répercuter la
 * décision distante dans la base locale : le contrôle local est alors d'accord
 * avec l'autorité, même hors ligne.
 *
 * MODÈLE DE CONFIANCE : l'appelant est le process Electron local — le même qui
 * pilote les migrations (/api/internal/migrate) et l'export. La route recalcule
 * le recordMac (HMAC d'intégrité) dans la MÊME transaction que le changement de
 * statut, exactement comme PATCH /api/admin/licenses/[id] : jamais d'état
 * « statut changé mais MAC périmé » qui ferait passer la ligne pour altérée.
 *
 * Body    : { licenseId: string, status: 'active' | 'suspended' | 'revoked' }
 * Réponse : { ok: true, status } | { ok: true, noop: true } (licence inconnue
 *           localement — rien à refléter) | { ok: false, errorCode }
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { computeRecordMac } from '@/lib/license/record-mac'
import { logger } from '@/lib/logger'

const ALLOWED_STATUSES = new Set(['active', 'suspended', 'revoked'])

export async function POST(req: NextRequest) {
  if (!internalRequestAuthorized(req)) {
    return NextResponse.json({ ok: false, errorCode: 'UNAUTHORIZED' }, { status: 401 })
  }

  let licenseId: string
  let status: string
  try {
    const body = await req.json()
    licenseId = String(body.licenseId ?? '').trim()
    status    = String(body.status ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (!licenseId || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ ok: false, errorCode: 'VALIDATION_ERROR' }, { status: 400 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.licenseKey.findUnique({ where: { licenseId } })
      if (!current) return null            // pas encore enregistrée localement
      if (current.status === status) return current // idempotent

      // MAC recalculé sur le NOUVEL état, dans la même transaction (cf. la
      // note GF31-AUD-006 dans PATCH /api/admin/licenses/[id] : les champs
      // mécanicien font partie du message dès qu'ils sont non nuls).
      const recordMac = computeRecordMac({
        licenseId:       current.licenseId,
        token:           current.token,
        status,
        expiryAt:        current.expiryAt,
        hwid:            current.hwid ?? null,
        parentLicenseId: current.parentLicenseId ?? null,
        mechanicId:      current.mechanicId ?? null,
      })
      return tx.licenseKey.update({
        where: { id: current.id },
        data: {
          status,
          recordMac,
          // revokedAt suit le statut : posé à la révocation, effacé par une
          // réactivation (décision de l'autorité distante), inchangé sinon.
          revokedAt: status === 'revoked' ? new Date()
                   : status === 'active'  ? null
                   : current.revokedAt,
        },
      })
    })

    if (!updated) return NextResponse.json({ ok: true, noop: true })
    logger.info('[internal/license-status] statut local reflété', {
      lid: updated.licenseId, status: updated.status,
    })
    return NextResponse.json({ ok: true, status: updated.status })
  } catch (err) {
    logger.error('[internal/license-status] échec du miroir local', err)
    return NextResponse.json({ ok: false, errorCode: 'DB_ERROR' }, { status: 500 })
  }
}

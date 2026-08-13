export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/licenses/[id]  — update status / label / notes / hwid
 * DELETE /api/admin/licenses/[id] — remove key from registry
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { isAdminSession } from '@/lib/api-helpers'
import { computeRecordMac } from '@/lib/license/record-mac'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID invalide' }, { status: 400 })
  }

  let body: {
    status?:  'active' | 'revoked' | 'suspended'
    label?:   string | null
    notes?:   string | null
    hwid?:    string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    data.status = body.status
    if (body.status === 'revoked') data.revokedAt = new Date()
    if (body.status === 'active')  data.revokedAt = null
  }
  if (body.label !== undefined) data.label = body.label
  if (body.notes !== undefined) data.notes = body.notes
  if (body.hwid  !== undefined) data.hwid  = body.hwid

  try {
    // ATOMIQUE : lecture + recalcul du recordMac + écriture sous verrou de ligne,
    // sinon deux éditions concurrentes de la MÊME clé sur des champs DIFFÉRENTS
    // (ex. status vs hwid) pouvaient laisser un recordMac calculé sur un état
    // périmé → MAC incohérent → licence considérée « tampered » et bloquée.
    const updated = await prisma.$transaction(async (tx) => {
      if (isPostgresDatabase()) {
        // Sérialise les éditions concurrentes de cette licence (PostgreSQL).
        await tx.$executeRaw`SELECT "id" FROM "LicenseKey" WHERE "id" = ${id} FOR UPDATE`
      }
      // Re-compute MAC whenever security-critical fields may have changed
      if (body.status !== undefined || body.hwid !== undefined) {
        const current = await tx.licenseKey.findUnique({ where: { id } })
        if (!current) throw Object.assign(new Error('not found'), { code: 'P2025' })
        // Les champs MÉCANICIEN (parentLicenseId, mechanicId) font partie du
        // message signé dès qu'ils sont non nuls. Les omettre ici produisait un
        // MAC calculé sur un message PLUS COURT que celui que `verifyRecordMac`
        // reconstruit ensuite à partir de la ligne réelle : toute suspension,
        // réactivation ou modification de HWID d'une clé mécanicien attribuée
        // laissait donc la licence définitivement vue comme « altérée »
        // (`MECHANIC_LICENSE_TAMPERED`) — GF31-AUD-006.
        data.recordMac = computeRecordMac({
          licenseId: current.licenseId,
          token:     current.token,
          status:    (body.status ?? current.status) as string,
          expiryAt:  current.expiryAt,
          hwid:      (body.hwid !== undefined ? body.hwid : current.hwid) ?? null,
          parentLicenseId: current.parentLicenseId ?? null,
          mechanicId:      current.mechanicId ?? null,
        })
      }
      return tx.licenseKey.update({ where: { id }, data })
    })
    return NextResponse.json(updated)
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Licence introuvable' }, { status: 404 })
    }
    logger.error('[admin/licenses/patch] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID invalide' }, { status: 400 })
  }

  try {
    await prisma.licenseKey.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Licence introuvable' }, { status: 404 })
    }
    logger.error('[admin/licenses/delete] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

/**
 * Encrypted backups (Phase 1) — owner only.
 *   GET  — list this garage's backups (history).
 *   POST — create a new AES-256-GCM backup. Body: { passphrase?, note? }
 *          Without a passphrase, GF_BACKUP_KEY is used.
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { createBackup, listBackups } from '@/lib/backup/service'

function requireOwner(session: Session): void {
  if (session.user.role !== 'OWNER') {
    throw NextResponse.json({ error: 'Réservé au propriétaire du garage' }, { status: 403 })
  }
}

function safeParse(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export const GET = withAuth(async () => {
  const session = await requireSession()
  requireOwner(session)
  const backups = await listBackups(session.user.garageId)
  return NextResponse.json({
    backups: backups.map(b => ({
      id: b.id,
      createdAt: b.createdAt,
      sizeBytes: b.sizeBytes,
      algorithm: b.algorithm,
      kdf: b.kdf,
      status: b.status,
      note: b.note,
      entityCounts: safeParse(b.entityCounts),
    })),
  })
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  requireOwner(session)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const passphrase = typeof body.passphrase === 'string' && body.passphrase ? body.passphrase : undefined
  const note = typeof body.note === 'string' ? body.note : undefined

  const record = await createBackup(session.user.garageId, { passphrase, note })
  return NextResponse.json(
    { ok: true, backup: { id: record.id, createdAt: record.createdAt, sizeBytes: record.sizeBytes, kdf: record.kdf, entityCounts: safeParse(record.entityCounts) } },
    { status: 201 },
  )
})

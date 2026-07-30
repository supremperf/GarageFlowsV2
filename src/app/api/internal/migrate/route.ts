export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/migrate
 * Versioned SQLite schema migrations — called once by Electron on startup.
 * Protected by X-Internal-Key header.
 *
 * Migrations are tracked in a _gf_migrations table so each one runs exactly
 * once regardless of how many times this endpoint is called. No more fragile
 * "duplicate column" error detection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { MIGRATIONS } from '@/lib/migrations'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  if (!internalRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ensure the migration-tracking table exists
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_gf_migrations" (
      "id"        TEXT PRIMARY KEY,
      "appliedAt" TEXT NOT NULL
    )
  `)

  // Réponse SANS le SQL ni le message d'erreur brut : l'identifiant de
  // migration et le statut suffisent au processus Electron ; le détail
  // technique part dans les logs serveur redactés.
  const results: { id: string; status: 'ok' | 'skip' | 'error' }[] = []

  for (const { id, sql } of MIGRATIONS) {
    // Check if already applied — skip without touching the schema
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "_gf_migrations" WHERE id = ?`, id
    )
    if (rows.length > 0) {
      results.push({ id, status: 'skip' })
      continue
    }

    try {
      await prisma.$executeRawUnsafe(sql)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_gf_migrations" (id, appliedAt) VALUES (?, ?)`,
        id,
        new Date().toISOString()
      )
      results.push({ id, status: 'ok' })
    } catch (err) {
      logger.error('[internal/migrate] échec migration', { id }, err)
      results.push({ id, status: 'error' })
    }
  }

  const hasError = results.some(r => r.status === 'error')
  return NextResponse.json({ ok: !hasError, results }, { status: hasError ? 500 : 200 })
}

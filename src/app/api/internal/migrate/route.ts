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
import { MIGRATIONS, duplicateGroupsSql, createUniqueIndexSql, tableColumnsSql, type ColumnGuard } from '@/lib/migrations'
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
  // 'deferred' : index UNIQUE non créé car des doublons existent — RÉESSAYÉ au
  // prochain démarrage (jamais enregistré comme appliqué), sans échec bloquant.
  const results: { id: string; status: 'ok' | 'skip' | 'error' | 'deferred' }[] = []

  for (const migration of MIGRATIONS) {
    const { id } = migration
    // Check if already applied — skip without touching the schema
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "_gf_migrations" WHERE id = ?`, id
    )
    if (rows.length > 0) {
      results.push({ id, status: 'skip' })
      continue
    }

    // ── Gardes conditionnelles sur l'état RÉEL du schéma ────────────────────
    // Une base neuve (créée au schéma actuel) n'a plus les anciennes colonnes
    // Float : les migrations de backfill/drop ne s'y appliquent pas — on les
    // marque appliquées SANS effet (déterministe, pas d'erreur en boucle).
    const columnExists = async (g: ColumnGuard) => {
      const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(tableColumnsSql(g.table))
      return cols.some((c) => c.name === g.column)
    }
    if (migration.onlyIfColumnExists && !(await columnExists(migration.onlyIfColumnExists))) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_gf_migrations" (id, appliedAt) VALUES (?, ?)`, id, new Date().toISOString()
      )
      results.push({ id, status: 'skip' })
      continue
    }
    if (migration.onlyIfColumnMissing && (await columnExists(migration.onlyIfColumnMissing))) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_gf_migrations" (id, appliedAt) VALUES (?, ?)`, id, new Date().toISOString()
      )
      results.push({ id, status: 'skip' })
      continue
    }

    try {
      if (migration.uniqueIndex) {
        // ── Index UNIQUE avec CONTRÔLE DE DOUBLONS ──────────────────────────
        // On détecte d'abord les groupes en doublon (hors NULL). S'il en existe,
        // créer un index UNIQUE échouerait : on DIFFÈRE (log, pas d'échec, pas de
        // suppression de données) — la migration sera réessayée une fois les
        // doublons résolus par l'opérateur.
        const dupes = await prisma.$queryRawUnsafe<unknown[]>(
          duplicateGroupsSql(migration.uniqueIndex)
        )
        if (dupes.length > 0) {
          logger.warn('[internal/migrate] index UNIQUE différé — doublons présents', {
            id,
            table: migration.uniqueIndex.table,
            columns: migration.uniqueIndex.columns,
          })
          results.push({ id, status: 'deferred' })
          continue // NON enregistré → réessayé au prochain démarrage
        }
        await prisma.$executeRawUnsafe(createUniqueIndexSql(migration.uniqueIndex))
      } else {
        await prisma.$executeRawUnsafe(migration.sql as string)
      }
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

  // Un index UNIQUE différé (doublons) n'est PAS une erreur bloquante.
  const hasError = results.some(r => r.status === 'error')
  return NextResponse.json({ ok: !hasError, results }, { status: hasError ? 500 : 200 })
}

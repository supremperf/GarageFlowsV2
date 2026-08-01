export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/migrate
 * Migrations de schéma SQLite versionnées — appelées une fois par Electron au
 * démarrage. Protégé par l'en-tête X-Internal-Key.
 *
 * Garanties (voir src/lib/migration-runner.ts) :
 *   - suivi individuel dans `_gf_migrations` (chaque migration jouée une fois) ;
 *   - version de schéma lisible dans `_gf_schema` ;
 *   - SAUVEGARDE automatique du fichier base avant d'appliquer des migrations
 *     en attente ;
 *   - VALIDATION post-migration (intégrité + tables critiques) ;
 *   - ROLLBACK (restauration de la sauvegarde) si l'intégrité est corrompue.
 *
 * La réponse ne contient ni SQL ni message d'erreur brut : ids + statuts +
 * version + validation suffisent au processus Electron ; le détail technique
 * part dans les logs serveur redactés.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { SCHEMA_VERSION } from '@/lib/migrations'
import {
  ensureTrackingTables, appliedMigrationIds, pendingMigrations, applyPending,
  writeSchemaVersion, validateSchema, isConfirmedCorruption, type RawDb,
} from '@/lib/migration-runner'
import {
  resolveSqliteFile, backupBeforeMigration, restoreFromBackup, pruneMigrationBackups,
} from '@/lib/migration-backup'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  if (!internalRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: RawDb = {
    exec: async (sql, params) => { await prisma.$executeRawUnsafe(sql, ...(params ?? [])) },
    query: async (sql, params) => (await prisma.$queryRawUnsafe(sql, ...(params ?? []))) as never,
  }

  // Les migrations de cette liste sont écrites pour SQLite (desktop). En
  // PostgreSQL (serveur), le schéma est géré par `prisma migrate deploy`.
  if (isPostgresDatabase()) {
    return NextResponse.json({ ok: true, skipped: 'postgres' })
  }

  const dbPath = resolveSqliteFile(process.env.DATABASE_URL)

  await ensureTrackingTables(db)
  const applied = await appliedMigrationIds(db)
  const pending = pendingMigrations(applied)

  // Sauvegarde AVANT toute modification, uniquement s'il y a des migrations en
  // attente et que le fichier base est résolu (installation existante).
  let backupPath: string | null = null
  if (pending.length > 0 && dbPath) {
    try {
      backupPath = backupBeforeMigration(dbPath)
      pruneMigrationBackups(dbPath)
    } catch (err) {
      logger.error('[internal/migrate] sauvegarde pré-migration impossible', {}, err)
      // On n'applique pas de migrations sans filet si une base existe déjà.
      return NextResponse.json(
        { ok: false, error: 'backup_failed', schemaVersion: await currentVersion(db) },
        { status: 500 },
      )
    }
  }

  const results = await applyPending(db, pending, (id, err) => {
    logger.error('[internal/migrate] échec migration', { id }, err)
  })
  await writeSchemaVersion(db, SCHEMA_VERSION)

  const validation = await validateSchema(db)

  // Rollback UNIQUEMENT sur corruption confirmée par SQLite, et seulement si une
  // sauvegarde pré-migration existe (sinon on ne peut rien restaurer).
  let rolledBack = false
  if (isConfirmedCorruption(validation) && backupPath && dbPath) {
    try {
      restoreFromBackup(dbPath, backupPath)
      rolledBack = true
      logger.error('[internal/migrate] intégrité compromise → base restaurée depuis la sauvegarde', {
        integrity: validation.integrity,
      })
    } catch (err) {
      logger.error('[internal/migrate] échec de la restauration après corruption', {}, err)
    }
  }

  const hasError = results.some(r => r.status === 'error')
  const ok = !hasError && validation.ok && !rolledBack
  return NextResponse.json(
    {
      ok,
      results,
      schemaVersion: SCHEMA_VERSION,
      validation,
      rolledBack,
      backedUp: Boolean(backupPath),
    },
    { status: ok ? 200 : 500 },
  )
}

/** Lit la version de schéma courante sans planter si la table n'existe pas encore. */
async function currentVersion(db: RawDb): Promise<number> {
  try {
    const rows = await db.query<{ version: number }>(`SELECT "version" FROM "_gf_schema" WHERE "id" = 1`)
    return rows.length ? Number(rows[0].version) : 0
  } catch {
    return 0
  }
}

export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/migrate — migrations SQLite versionnées (desktop).
 * Appelée par Electron au démarrage, APRÈS la sauvegarde pré-migration et AVANT
 * l'ouverture de la fenêtre. Protégée par X-Internal-Key.
 *
 * GARANTIES (fail-closed) :
 *  - VERROU : une seule exécution à la fois (409 sinon) ;
 *  - INTÉGRITÉ : PRAGMA integrity_check + foreign_key_check AVANT et APRÈS —
 *    une base corrompue bloque tout (aucune migration tentée) ;
 *  - ATOMICITÉ : chaque migration (y compris composite ADD→BACKFILL→VERIFY→DROP)
 *    s'exécute dans UNE transaction ; l'enregistrement dans _gf_migrations fait
 *    partie de la MÊME transaction → jamais d'état « appliquée mais ratée » ;
 *  - ARRÊT IMMÉDIAT : la première erreur stoppe la boucle — aucune migration
 *    suivante, aucune étape destructive après un échec, réponse HTTP 500
 *    structurée { ok:false, failedMigration, stage, errorCode } ;
 *  - CHECKSUMS : une migration déjà enregistrée dont la définition a changé
 *    est BLOQUÉE (divergence signalée, jamais ré-exécutée silencieusement) ;
 *  - VERIFY : un backfill divergent lève une exception AVANT le DROP (rollback).
 *
 * Réponse (contrat) :
 *  succès : { ok:true, schemaVersionBefore, schemaVersionAfter, applied[], skipped[], warnings[], integrity:'ok' }
 *  échec  : { ok:false, failedMigration, stage, errorCode, recoverable:true }
 * Aucun secret ni donnée client dans les réponses ; le détail technique part
 * dans les logs serveur.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import {
  MIGRATIONS,
  duplicateGroupsSql,
  createUniqueIndexSql,
  tableColumnsSql,
  type ColumnGuard,
  type Migration,
} from '@/lib/migrations'
import {
  parseWorksJson,
  parsePartsJson,
  parsePoLinesJson,
  serializeWorksJsonV2,
  serializePartsJsonV2,
  serializePoLinesJsonV2,
  workOrderTotalHtCents,
  poTotalHtCents,
} from '@/lib/money-json'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { logger } from '@/lib/logger'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Empreinte stable de la DÉFINITION d'une migration (détection de divergence). */
function migrationChecksum(m: Migration): string {
  return createHash('sha256')
    .update(JSON.stringify({ sql: m.sql ?? null, steps: m.steps ?? null, uniqueIndex: m.uniqueIndex ?? null, kind: m.kind ?? null }))
    .digest('hex')
}

class MigrationFailure extends Error {
  constructor(public stage: string, public errorCode: string, message: string) {
    super(message)
  }
}

async function columnExists(tx: Tx, g: ColumnGuard): Promise<boolean> {
  const cols = await tx.$queryRawUnsafe<{ name: string }[]>(tableColumnsSql(g.table))
  return cols.some((c) => c.name === g.column)
}

/** PRAGMA integrity_check + foreign_key_check — résultat CONTRÔLÉ, pas juste loggé. */
async function checkDbIntegrity(): Promise<{ ok: boolean; detail: string }> {
  const integ = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check')
  const integOk = integ.length === 1 && integ[0]?.integrity_check === 'ok'
  const fk = await prisma.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check')
  const fkOk = fk.length === 0
  return { ok: integOk && fkOk, detail: integOk ? (fkOk ? 'ok' : `foreign_key_check: ${fk.length} violation(s)`) : 'integrity_check failed' }
}

/**
 * Migration de DONNÉES 'json-v2' : convertit worksJson/partsJson (OR NON SIGNÉS
 * uniquement — le JSON d'un ordre signé est canonicalisé verbatim dans le
 * document signé et reste GELÉ) et linesJson (tous les bons de commande) vers
 * le format v2 (entiers exacts). Vérifie chaque conversion : total recalculé vs
 * total stocké (tolérance = 1 centime × nombre de lignes — différence d'ordre
 * d'arrondi historique documentée) ; au-delà → ÉCHEC (rollback, rien d'écrit).
 */
async function runJsonV2Migration(tx: Tx): Promise<void> {
  // Ordres de réparation NON signés.
  const wos = await tx.workOrder.findMany({
    where: { signedAt: null, signatureData: null },
    select: { id: true, worksJson: true, partsJson: true, totalHtCents: true },
  })
  for (const wo of wos) {
    const works = parseWorksJson(wo.worksJson)
    const parts = parsePartsJson(wo.partsJson)
    if (works.version === 2 && parts.version === 2) continue // déjà migré
    const recalced = workOrderTotalHtCents(works.lines, parts.lines)
    const lineCount = works.lines.length + parts.lines.length
    if (Math.abs(recalced - wo.totalHtCents) > Math.max(1, lineCount)) {
      throw new MigrationFailure(
        'VERIFY',
        'JSON_TOTAL_MISMATCH',
        `WorkOrder ${wo.id}: total recalculé ${recalced}c ≠ stocké ${wo.totalHtCents}c (tolérance ${Math.max(1, lineCount)}c)`,
      )
    }
    const worksJson = serializeWorksJsonV2(works.lines)
    const partsJson = serializePartsJsonV2(parts.lines)
    // Relecture de contrôle AVANT écriture (le v2 produit doit être re-parsable).
    parseWorksJson(worksJson)
    parsePartsJson(partsJson)
    await tx.workOrder.update({ where: { id: wo.id }, data: { worksJson, partsJson } })
  }
  // Bons de commande (jamais signés) — tous.
  const pos = await tx.purchaseOrder.findMany({ select: { id: true, linesJson: true, totalHtCents: true } })
  for (const po of pos) {
    const parsed = parsePoLinesJson(po.linesJson)
    if (parsed.version === 2) continue
    const recalced = poTotalHtCents(parsed.lines)
    const tol = Math.max(1, parsed.lines.length)
    if (Math.abs(recalced - po.totalHtCents) > tol) {
      throw new MigrationFailure('VERIFY', 'JSON_TOTAL_MISMATCH', `PurchaseOrder ${po.id}: total recalculé ${recalced}c ≠ stocké ${po.totalHtCents}c`)
    }
    const linesJson = serializePoLinesJsonV2(parsed.lines)
    parsePoLinesJson(linesJson)
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { linesJson } })
  }
}

/** Registre : création + mise à niveau idempotente (name/checksum/schemaVersion). */
async function ensureRegistry(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_gf_migrations" (
      "id"        TEXT PRIMARY KEY,
      "appliedAt" TEXT NOT NULL
    )
  `)
  const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(tableColumnsSql('_gf_migrations'))
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('name')) await prisma.$executeRawUnsafe('ALTER TABLE "_gf_migrations" ADD COLUMN "name" TEXT')
  if (!names.has('checksum')) await prisma.$executeRawUnsafe('ALTER TABLE "_gf_migrations" ADD COLUMN "checksum" TEXT')
  if (!names.has('schemaVersion')) await prisma.$executeRawUnsafe('ALTER TABLE "_gf_migrations" ADD COLUMN "schemaVersion" INTEGER')
}

// Verrou applicatif : une seule migration à la fois (process desktop unique).
let migrationInFlight = false

export async function POST(req: NextRequest) {
  if (!internalRequestAuthorized(req)) {
    return NextResponse.json({ ok: false, errorCode: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (migrationInFlight) {
    return NextResponse.json({ ok: false, errorCode: 'MIGRATION_IN_PROGRESS', recoverable: true }, { status: 409 })
  }
  migrationInFlight = true
  try {
    await ensureRegistry()

    // ── Intégrité AVANT toute migration : base corrompue → on ne touche à rien.
    const pre = await checkDbIntegrity()
    if (!pre.ok) {
      logger.error('[internal/migrate] intégrité pré-migration échouée', { detail: pre.detail })
      return NextResponse.json(
        { ok: false, stage: 'PRECHECK', errorCode: 'DB_INTEGRITY_FAILED', recoverable: false },
        { status: 500 },
      )
    }

    const recorded = await prisma.$queryRawUnsafe<Array<{ id: string; checksum: string | null }>>(
      'SELECT id, checksum FROM "_gf_migrations"',
    )
    const recordedMap = new Map(recorded.map((r) => [r.id, r.checksum]))
    const schemaVersionBefore = recorded.length

    const applied: string[] = []
    const skipped: string[] = []
    const warnings: string[] = []

    for (const migration of MIGRATIONS) {
      const { id } = migration
      const checksum = migrationChecksum(migration)

      if (recordedMap.has(id)) {
        const prev = recordedMap.get(id)
        // Divergence de définition : BLOQUANT (jamais ré-exécutée en silence).
        // (checksum NULL = enregistrement antérieur au registre v2 : accepté.)
        if (prev && prev !== checksum) {
          logger.error('[internal/migrate] checksum divergent', { id })
          return NextResponse.json(
            { ok: false, failedMigration: id, stage: 'CHECKSUM', errorCode: 'MIGRATION_CHECKSUM_MISMATCH', recoverable: false },
            { status: 500 },
          )
        }
        skipped.push(id)
        continue
      }

      // ── Index UNIQUE (non destructif) : contrôle de doublons, différable ────
      if (migration.uniqueIndex) {
        const dupes = await prisma.$queryRawUnsafe<unknown[]>(duplicateGroupsSql(migration.uniqueIndex))
        if (dupes.length > 0) {
          warnings.push(`${id}: index UNIQUE différé (doublons présents — réessayé au prochain démarrage)`)
          logger.warn('[internal/migrate] index UNIQUE différé', { id })
          continue // NON enregistré → réessayé ; non destructif, non bloquant
        }
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(createUniqueIndexSql(migration.uniqueIndex!))
            await tx.$executeRawUnsafe(
              'INSERT INTO "_gf_migrations" (id, appliedAt, name, checksum, schemaVersion) VALUES (?, ?, ?, ?, ?)',
              id, new Date().toISOString(), id, checksum, schemaVersionBefore + applied.length + 1,
            )
          })
          applied.push(id)
        } catch (err) {
          logger.error('[internal/migrate] échec index unique', { id }, err)
          return NextResponse.json(
            { ok: false, failedMigration: id, stage: 'INDEX', errorCode: 'MIGRATION_SQL_FAILED', recoverable: true },
            { status: 500 },
          )
        }
        continue
      }

      // ── Migration (simple / composite / données) — UNE transaction ──────────
      try {
        await prisma.$transaction(async (tx) => {
          if (migration.kind === 'json-v2') {
            await runJsonV2Migration(tx)
          } else if (migration.steps) {
            for (const step of migration.steps) {
              if (step.onlyIfColumnExists && !(await columnExists(tx, step.onlyIfColumnExists))) continue
              if (step.onlyIfColumnMissing && (await columnExists(tx, step.onlyIfColumnMissing))) continue
              if (step.verifySql) {
                const rows = await tx.$queryRawUnsafe<Array<{ n: number | bigint }>>(step.verifySql)
                const n = Number(rows[0]?.n ?? 0)
                if (n > 0) {
                  throw new MigrationFailure('VERIFY', 'MIGRATION_VERIFICATION_FAILED', `${id}: ${n} ligne(s) divergente(s)`)
                }
              } else if (step.sql) {
                await tx.$executeRawUnsafe(step.sql)
              }
            }
          } else {
            // Forme historique : garde sur la migration entière + un SQL.
            if (migration.onlyIfColumnExists && !(await columnExists(tx, migration.onlyIfColumnExists))) {
              // no-op : enregistrée comme appliquée (état déjà conforme)
            } else if (migration.onlyIfColumnMissing && (await columnExists(tx, migration.onlyIfColumnMissing))) {
              // no-op
            } else if (migration.sql) {
              await tx.$executeRawUnsafe(migration.sql)
            }
          }
          // Enregistrement DANS la même transaction : jamais « appliquée » sans l'être.
          await tx.$executeRawUnsafe(
            'INSERT INTO "_gf_migrations" (id, appliedAt, name, checksum, schemaVersion) VALUES (?, ?, ?, ?, ?)',
            id, new Date().toISOString(), id, checksum, schemaVersionBefore + applied.length + 1,
          )
        }, { timeout: 120_000 })
        applied.push(id)
      } catch (err) {
        // ARRÊT IMMÉDIAT : transaction annulée, aucune migration suivante.
        const failure = err instanceof MigrationFailure
          ? err
          : new MigrationFailure('SQL', 'MIGRATION_SQL_FAILED', (err as Error).message)
        logger.error('[internal/migrate] ÉCHEC — arrêt de la séquence', { id, stage: failure.stage }, err)
        return NextResponse.json(
          { ok: false, failedMigration: id, stage: failure.stage, errorCode: failure.errorCode, recoverable: true },
          { status: 500 },
        )
      }
    }

    // ── Intégrité APRÈS migrations : résultat contrôlé. ─────────────────────
    const post = await checkDbIntegrity()
    if (!post.ok) {
      logger.error('[internal/migrate] intégrité post-migration échouée', { detail: post.detail })
      return NextResponse.json(
        { ok: false, stage: 'POSTCHECK', errorCode: 'DB_INTEGRITY_FAILED', recoverable: false },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      schemaVersionBefore,
      schemaVersionAfter: schemaVersionBefore + applied.length,
      applied,
      skipped: skipped.length, // compte (la liste complète n'apporte rien au client)
      warnings,
      integrity: 'ok',
    })
  } finally {
    migrationInFlight = false
  }
}

/**
 * Moteur de migration desktop (SQLite) — versionné, idempotent, récupérable.
 *
 * Conçu pour les installations Electron : le template n'est copié qu'à la
 * première installation, donc les bases EXISTANTES doivent être mises à niveau
 * au démarrage. Ce moteur applique la liste `MIGRATIONS` avec ces garanties :
 *
 *   1. Suivi individuel dans `_gf_migrations` → chaque migration jouée une fois
 *      (résiliente : une migration qui échoue est retentée au prochain
 *      démarrage, sans être marquée appliquée — comportement historique préservé
 *      pour les index d'unicité qui échouent tant qu'il reste des doublons).
 *   2. Version de schéma lisible dans `_gf_schema` (diagnostic).
 *   3. Sauvegarde AUTOMATIQUE du fichier base AVANT d'appliquer des migrations
 *      en attente (orchestrée par l'appelant qui a accès au disque).
 *   4. Validation post-migration (`PRAGMA integrity_check` + tables critiques).
 *   5. Rollback : si l'intégrité est compromise après migration, l'appelant
 *      restaure la base depuis la sauvegarde pré-migration.
 *
 * Le cœur est PUR (aucun accès disque direct) : il reçoit des callbacks `exec`
 * et `query`, ce qui le rend testable contre un vrai SQLite (node:sqlite) et
 * réutilisable avec Prisma (`$executeRawUnsafe` / `$queryRawUnsafe`).
 */

import { MIGRATIONS, SCHEMA_VERSION, CRITICAL_TABLES, type Migration } from '@/lib/migrations'

/** Accès brut à la base, fourni par l'appelant (Prisma en prod, node:sqlite en test). */
export interface RawDb {
  /** Exécute une instruction sans résultat (DDL/DML). */
  exec(sql: string, params?: unknown[]): Promise<void>
  /** Exécute une requête et renvoie les lignes. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export type MigrationStatus = 'ok' | 'skip' | 'error'
export interface MigrationResult { id: string; status: MigrationStatus }

export interface ValidationResult {
  ok: boolean
  integrity: 'ok' | 'unknown' | string  // 'ok', 'unknown' (non vérifiable), ou le problème signalé
  missingTables: string[]                // tables critiques absentes
}

/**
 * Corruption CONFIRMÉE : SQLite a répondu à `integrity_check` par autre chose
 * que « ok ». Un échec d'exécution du PRAGMA (`'unknown'`) n'est PAS une
 * corruption confirmée → on ne déclenche jamais de rollback sur une simple
 * limitation du pilote (ex. PRAGMA non supporté par le client).
 */
export function isConfirmedCorruption(v: ValidationResult): boolean {
  return v.integrity !== 'ok' && v.integrity !== 'unknown'
}

export interface RunSummary {
  ok: boolean
  appliedCount: number
  results: MigrationResult[]
  schemaVersion: number
  validation: ValidationResult
}

/** Crée les tables de suivi (`_gf_migrations`, `_gf_schema`) si absentes. */
export async function ensureTrackingTables(db: RawDb): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS "_gf_migrations" (
    "id"        TEXT PRIMARY KEY,
    "appliedAt" TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS "_gf_schema" (
    "id"        INTEGER PRIMARY KEY CHECK ("id" = 1),
    "version"   INTEGER NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`)
}

/** Ensemble des ids de migration déjà appliqués. */
export async function appliedMigrationIds(db: RawDb): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(`SELECT id FROM "_gf_migrations"`)
  return new Set(rows.map(r => r.id))
}

/** Migrations restant à appliquer, dans l'ordre canonique. */
export function pendingMigrations(applied: Set<string>, list: readonly Migration[] = MIGRATIONS): Migration[] {
  return list.filter(m => !applied.has(m.id))
}

/**
 * Applique les migrations en attente, une par une, en suivant chacune.
 * Une migration qui échoue N'EST PAS marquée appliquée (retentée au prochain
 * démarrage) et n'interrompt pas les suivantes — comportement volontaire pour
 * les migrations « réparatrices » qui dépendent d'un état antérieur.
 * `now` est injecté pour des tests déterministes.
 */
export async function applyPending(
  db: RawDb,
  pending: readonly Migration[],
  onError: (id: string, err: unknown) => void,
  now: () => string = () => new Date().toISOString(),
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = []
  for (const { id, sql } of pending) {
    try {
      await db.exec(sql)
      await db.exec(`INSERT INTO "_gf_migrations" ("id", "appliedAt") VALUES (?, ?)`, [id, now()])
      results.push({ id, status: 'ok' })
    } catch (err) {
      onError(id, err)
      results.push({ id, status: 'error' })
    }
  }
  return results
}

/** Écrit la version de schéma courante (upsert du singleton). */
export async function writeSchemaVersion(db: RawDb, version: number, now: () => string = () => new Date().toISOString()): Promise<void> {
  await db.exec(
    `INSERT INTO "_gf_schema" ("id", "version", "updatedAt") VALUES (1, ?, ?)
     ON CONFLICT("id") DO UPDATE SET "version" = excluded."version", "updatedAt" = excluded."updatedAt"`,
    [version, now()],
  )
}

/** Lit la version de schéma enregistrée (0 si jamais écrite). */
export async function readSchemaVersion(db: RawDb): Promise<number> {
  const rows = await db.query<{ version: number }>(`SELECT "version" FROM "_gf_schema" WHERE "id" = 1`)
  return rows.length ? Number(rows[0].version) : 0
}

/** Liste les tables présentes (hors tables internes SQLite). */
export async function existingTables(db: RawDb): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  return new Set(rows.map(r => r.name))
}

/**
 * Validation post-migration : intégrité SQLite + présence des tables critiques.
 * L'intégrité est la garantie forte : si elle échoue, la base est corrompue et
 * l'appelant DOIT restaurer la sauvegarde pré-migration.
 */
export async function validateSchema(db: RawDb, critical: readonly string[] = CRITICAL_TABLES): Promise<ValidationResult> {
  let integrity: string = 'ok'
  try {
    const rows = await db.query<Record<string, string>>(`PRAGMA integrity_check`)
    // SQLite renvoie une seule ligne « ok », sinon une ligne par problème.
    const first = rows[0]
    const val = first ? Object.values(first)[0] : 'ok'
    integrity = typeof val === 'string' ? val : 'ok'
  } catch {
    integrity = 'unknown' // PRAGMA non exécutable : indéterminé, jamais assimilé à une corruption
  }
  const tables = await existingTables(db)
  const missingTables = critical.filter(t => !tables.has(t))
  const corrupt = integrity !== 'ok' && integrity !== 'unknown'
  return { ok: !corrupt && missingTables.length === 0, integrity, missingTables }
}

/**
 * Exécute le cycle complet côté base (sans disque) : suivi, application des
 * migrations en attente, mise à jour de version, validation. La sauvegarde et
 * le rollback fichier sont orchestrés par l'appelant (accès disque requis) au
 * moyen de `hadPending` / `validation.ok`.
 */
export async function runMigrations(
  db: RawDb,
  onError: (id: string, err: unknown) => void,
  opts: { list?: readonly Migration[]; version?: number; now?: () => string } = {},
): Promise<RunSummary & { hadPending: boolean }> {
  const list = opts.list ?? MIGRATIONS
  const version = opts.version ?? SCHEMA_VERSION
  await ensureTrackingTables(db)
  const applied = await appliedMigrationIds(db)
  const pending = pendingMigrations(applied, list)
  const results = await applyPending(db, pending, onError, opts.now)
  await writeSchemaVersion(db, version, opts.now)
  const validation = await validateSchema(db)
  const appliedCount = results.filter(r => r.status === 'ok').length
  const hasError = results.some(r => r.status === 'error')
  return {
    ok: !hasError && validation.ok,
    appliedCount,
    results,
    schemaVersion: version,
    validation,
    hadPending: pending.length > 0,
  }
}

/**
 * Non-régression : idempotence des migrations « ADD COLUMN » historiques.
 *
 * Contexte du bug corrigé — sur une base dont le schéma contenait DÉJÀ la colonne
 * (base créée depuis le schéma Prisma complet, ou mise à niveau partielle), la
 * migration rejouait `ALTER TABLE … ADD COLUMN` → SQLite renvoie
 * « duplicate column name » → le runner (migrate/route.ts) ARRÊTE toute la
 * séquence sur la première erreur → l'application ne démarrait plus.
 *
 * Le test ne dépend PAS de node:sqlite (absent en Node 20, la version utilisée
 * ici) : il vérifie la garde de façon statique et rejoue la DÉCISION du runner
 * avec un oracle de colonnes injecté. Le comportement réel de SQLite est couvert
 * bout-en-bout par l'exécution du runner sur la base de production.
 */
import { describe, it, expect } from 'vitest'
import { MIGRATIONS, type Migration } from '@/lib/migrations'

const ADD_COLUMN_RE = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/

/** Migrations de forme historique (sql unique) qui ajoutent une colonne. */
function addColumnMigrations(): Array<{ m: Migration; table: string; column: string }> {
  const out: Array<{ m: Migration; table: string; column: string }> = []
  for (const m of MIGRATIONS) {
    if (!m.sql) continue
    const hit = m.sql.match(ADD_COLUMN_RE)
    if (hit) out.push({ m, table: hit[1], column: hit[2] })
  }
  return out
}

/**
 * Reproduit la décision du runner pour la forme historique (migrate/route.ts) :
 * `exists(table, column)` est l'oracle que le runner obtient via PRAGMA table_info.
 */
function runnerDecision(m: Migration, exists: (t: string, c: string) => boolean): 'sql' | 'no-op' {
  if (m.onlyIfColumnExists && !exists(m.onlyIfColumnExists.table, m.onlyIfColumnExists.column)) return 'no-op'
  if (m.onlyIfColumnMissing && exists(m.onlyIfColumnMissing.table, m.onlyIfColumnMissing.column)) return 'no-op'
  return m.sql ? 'sql' : 'no-op'
}

describe('garde d’idempotence des migrations ADD COLUMN', () => {
  it('il existe bien des migrations ADD COLUMN de forme historique', () => {
    expect(addColumnMigrations().length).toBeGreaterThan(50)
  })

  it('chacune porte onlyIfColumnMissing sur la table/colonne exactes', () => {
    const manquantes = addColumnMigrations()
      .filter(({ m, table, column }) =>
        m.onlyIfColumnMissing?.table !== table || m.onlyIfColumnMissing?.column !== column)
      .map(({ m }) => m.id)
    expect(manquantes).toEqual([])
  })

  it('colonne DÉJÀ présente → aucun SQL émis (cas exact de la panne)', () => {
    // Base réelle en panne : JobPhoto.photoPath existe, mais 001 n'est pas au registre.
    const m = MIGRATIONS.find((x) => x.id === '001_job_photo_path')
    expect(m).toBeDefined()
    expect(runnerDecision(m!, (t, c) => t === 'JobPhoto' && c === 'photoPath')).toBe('no-op')
  })

  it('colonne absente → le SQL est bien exécuté (la garde ne casse pas le cas utile)', () => {
    const m = MIGRATIONS.find((x) => x.id === '001_job_photo_path')!
    expect(runnerDecision(m, () => false)).toBe('sql')
  })

  it('sur une base au schéma complet, AUCUNE migration ADD COLUMN n’émet de SQL', () => {
    // Toutes les colonnes visées existent déjà → toutes doivent être des no-op.
    const cibles = new Set(addColumnMigrations().map(({ table, column }) => `${table}.${column}`))
    const emettent = addColumnMigrations()
      .filter(({ m }) => runnerDecision(m, (t, c) => cibles.has(`${t}.${c}`)) === 'sql')
      .map(({ m }) => m.id)
    expect(emettent).toEqual([])
  })
})

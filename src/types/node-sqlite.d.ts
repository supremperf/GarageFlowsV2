/**
 * Déclaration ambiante minimale pour `node:sqlite` (SQLite intégré à Node 22+,
 * expérimental) — absent de @types/node@20. Ne couvre que le sous-ensemble
 * utilisé par les tests (src/lib/__tests__/migrations-unique-index.test.ts).
 * Aucun @ts-ignore : les types réels sont fournis ici.
 */
declare module 'node:sqlite' {
  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

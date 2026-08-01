/**
 * Déclarations de types minimales pour `node:sqlite` (API SQLite intégrée à
 * Node ≥ 22, expérimentale — non encore couverte par la version de @types/node
 * du projet). Limité aux membres réellement utilisés (tests du moteur de
 * migration). À retirer quand @types/node fournira ces définitions.
 */
declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
  export const constants: Record<string, number>
}

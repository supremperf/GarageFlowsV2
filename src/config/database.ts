/**
 * Database configuration constants.
 *
 * L'application utilise DEUX schémas Prisma distincts (voir
 * docs/DATABASE_ARCHITECTURE.md) :
 *  - desktop : prisma/schema.prisma        → SQLite  (Electron mono-poste)
 *  - serveur : prisma/server/schema.prisma → PostgreSQL (PWA multi-instance)
 * Le client est choisi à l'exécution selon DATABASE_URL (src/lib/db.ts).
 */

export const DB_CONFIG = {
  /** Provider desktop (Electron). Le serveur/PWA utilise PostgreSQL. */
  desktopProvider: 'sqlite' as const,
  /** Provider serveur (PWA production). */
  serverProvider: 'postgresql' as const,

  /** Prisma log levels per environment */
  logLevels: {
    development: ['error', 'warn'] as const,
    production:  ['error']         as const,
  },

  /** Backup retention counts (Electron local backups) */
  backup: {
    /** Keep this many hourly backups */
    keepHourly:  24,
    /** Keep this many daily backups */
    keepDaily:   7,
    /** Keep this many weekly backups */
    keepWeekly:  4,
  },
} as const

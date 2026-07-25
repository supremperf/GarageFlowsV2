/**
 * Database configuration constants.
 */

export const DB_CONFIG = {
  /** SQLite provider (switch to "postgresql" for cloud deployment) */
  provider: 'sqlite' as const,

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

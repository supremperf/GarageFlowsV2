/**
 * Prisma client for the CENTRAL license database (PostgreSQL).
 *
 * This is a SECOND, independent Prisma client (generated from
 * prisma/license.prisma into src/generated/license-client) — distinct from the
 * garage-business client in ./db.ts (SQLite). Licenses live ONLY here.
 *
 * On the central server deployment (app.garageflows.fr) LICENSE_DATABASE_URL is
 * set and this client is the source of truth. On a desktop client it is left
 * unset: the desktop validates over HTTPS and never touches this client, so we
 * construct it lazily-safe (a placeholder URL that only fails if actually
 * queried) and expose `licenseAuthorityConfigured()` so routes can answer 503
 * instead of crashing.
 */

import { PrismaClient } from '@/generated/license-client'

/** True only where this node is the authoritative license server. */
export function licenseAuthorityConfigured(): boolean {
  return !!process.env.LICENSE_DATABASE_URL && process.env.LICENSE_DATABASE_URL.trim().length > 0
}

declare global {
  // eslint-disable-next-line no-var
  var licensePrisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  return new PrismaClient({
    // Explicit URL with a harmless fallback so constructing the client never
    // throws at import time on a desktop build (where the var is unset). Any
    // actual query then fails clearly, and routes guard with the check above.
    datasources: {
      db: { url: process.env.LICENSE_DATABASE_URL || 'postgresql://unconfigured:5432/none' },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const licenseDb = global.licensePrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  global.licensePrisma = licenseDb
}

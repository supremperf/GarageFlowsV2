/**
 * Client Prisma unique de l'application — sélection du moteur à l'exécution.
 *
 * Deux clients Prisma distincts sont générés (voir docs/DATABASE_ARCHITECTURE.md) :
 *  - desktop : prisma/schema.prisma         (SQLite,     sortie @prisma/client)
 *  - serveur : prisma/server/schema.prisma  (PostgreSQL, sortie src/generated/server-client)
 *
 * Les deux schémas exposent exactement les mêmes modèles ; seul le provider
 * change. Le choix se fait sur DATABASE_URL :
 *  - postgresql://…  → client serveur (PWA multi-instance, Vercel)
 *  - file:…          → client desktop (Electron, dev local)
 *
 * Il est donc impossible d'utiliser le client SQLite contre PostgreSQL (ou
 * l'inverse) : l'ancien conflit « provider sqlite + URL postgres » est résolu
 * structurellement. src/lib/env.ts refuse par ailleurs SQLite en production PWA.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaClient as ServerPrismaClient } from '@/generated/server-client'

/** Vrai si DATABASE_URL désigne un PostgreSQL (déploiement serveur/PWA). */
export function isPostgresDatabase(): boolean {
  return /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')
}

const LOG_LEVELS =
  process.env.NODE_ENV === 'development'
    ? (['error', 'warn'] as const)
    : (['error'] as const)

function createClient(): PrismaClient {
  if (isPostgresDatabase()) {
    // Client généré depuis le schéma PostgreSQL — API structurellement identique.
    return new ServerPrismaClient({ log: [...LOG_LEVELS] }) as unknown as PrismaClient
  }
  return new PrismaClient({ log: [...LOG_LEVELS] })
}

// Prevent multiple instances of Prisma Client in development
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

export const prisma = global.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import bcrypt from 'bcryptjs'

/**
 * Configuration NextAuth (CredentialsProvider) — chaîne d'authentification web.
 *
 * OBSERVABILITÉ (mission §4.2) : `authorize()` émet des journaux structurés
 * AUTH_STEP_* permettant de diagnostiquer un échec sans JAMAIS exposer de donnée
 * sensible. Chaque ligne ne contient qu'un identifiant de requête éphémère, le
 * nom de l'étape, un résultat technique, un éventuel type d'erreur et la durée.
 * Ni l'e-mail, ni le mot de passe, ni le hash ne sont journalisés (le logger
 * applique de surcroît une redaction centralisée — voir src/lib/redact.ts).
 *
 * STATUTS (mission §4.3) :
 *  - identifiants absents / invalides → `null` (échec d'auth normal, pas de 500) ;
 *  - utilisateur inexistant / mauvais mot de passe → `null` (jamais de 500) ;
 *  - indisponibilité base / erreur interne → journalisée puis relevée (jamais
 *    masquée en « identifiants invalides » ni transformée en succès).
 *
 * Le `secret` n'est pas codé ici : NextAuth lit NEXTAUTH_SECRET (validé au
 * démarrage par src/lib/env.ts — fail-fast en production).
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 jours
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'credentials',

      credentials: {
        email: {
          label: 'Email',
          type: 'email',
        },
        password: {
          label: 'Mot de passe',
          type: 'password',
        },
      },

      async authorize(credentials) {
        // SÉCURITÉ : ne jamais journaliser les identifiants, mots de passe ou
        // hashs. On ne trace que des événements non sensibles + une durée.
        const rid = randomUUID().slice(0, 8)
        const t0 = Date.now()
        const step = (name: string, result: string, extra?: Record<string, unknown>) =>
          logger.info('AUTH', { rid, step: name, result, ms: Date.now() - t0, ...(extra ?? {}) })

        step('AUTH_STEP_1_AUTHORIZE_ENTERED', 'ok')

        if (!credentials?.email || !credentials?.password) {
          step('AUTH_STEP_2_INPUT_VALIDATED', 'missing_fields')
          return null
        }
        step('AUTH_STEP_2_INPUT_VALIDATED', 'ok')

        const email = credentials.email.toLowerCase()

        step('AUTH_STEP_4_DATABASE_STARTED', 'ok')
        let user: Awaited<ReturnType<typeof prisma.user.findUnique>> & { garage?: unknown } | null
        try {
          user = await prisma.user.findUnique({
            where: { email },
            include: { garage: true },
          })
        } catch (err) {
          // Indisponibilité base / erreur interne : journaliser côté serveur et
          // NE PAS masquer en « identifiants invalides ». On relève une erreur
          // générique → NextAuth conclut à un échec d'authentification tracé
          // (jamais un 200, jamais une session émise sans vérification réussie).
          step('AUTH_STEP_5_USER_LOOKUP_COMPLETED', 'db_error', {
            error: err instanceof Error ? err.name : 'unknown',
          })
          logger.error('[auth] échec accès base pendant authorize', err)
          throw new Error('AUTH_INFRA_ERROR')
        }

        if (!user) {
          step('AUTH_STEP_5_USER_LOOKUP_COMPLETED', 'user_not_found')
          return null
        }
        step('AUTH_STEP_5_USER_LOOKUP_COMPLETED', 'user_found')

        const valid = await bcrypt.compare(credentials.password, (user as { password: string }).password)
        if (!valid) {
          step('AUTH_STEP_6_PASSWORD_CHECK_COMPLETED', 'invalid_password')
          return null
        }
        step('AUTH_STEP_6_PASSWORD_CHECK_COMPLETED', 'ok')

        // Garde défensive : un utilisateur sans garage rattaché (donnée corrompue
        // ou migration incomplète) ne doit pas faire planter authorize (500) —
        // on refuse proprement et on le trace pour investigation.
        const garage = (user as { garage?: { name: string; slug: string } | null }).garage
        if (!garage) {
          step('AUTH_STEP_7_GARAGE_CHECK_COMPLETED', 'no_garage', {
            userId: (user as { id: string }).id,
          })
          logger.error('[auth] utilisateur sans garage rattaché pendant authorize')
          return null
        }
        step('AUTH_STEP_7_GARAGE_CHECK_COMPLETED', 'ok')

        step('AUTH_STEP_9_AUTH_RESULT_CREATED', 'ok')
        const u = user as {
          id: string; email: string; name: string | null; role: string; garageId: string
        }
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          garageId: u.garageId,
          garageName: garage.name,
          garageSlug: garage.slug,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
        token.garageId = (user as any).garageId
        token.garageName = (user as any).garageName
        token.garageSlug = (user as any).garageSlug
      }

      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.garageId = token.garageId as string
        session.user.garageName = token.garageName as string
        session.user.garageSlug = token.garageSlug as string
      }

      return session
    },
  },
}

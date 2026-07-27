import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { logger } from '@/lib/logger'
import { logLogin } from '@/lib/audit'

/**
 * NextAuth configuration (credentials provider, JWT sessions).
 *
 * Secret: NextAuth reads `NEXTAUTH_SECRET` from the environment. Its presence and
 * strength are enforced centrally — at boot by {@link file://src/instrumentation.ts}
 * (`assertStartupEnv`) and per-request by the middleware/session helpers, which
 * throw rather than fall back to any default. There is intentionally no hard-coded
 * secret here.
 *
 * Security note: this handler must never log credentials or password hashes.
 */

/** Best-effort client IP from the NextAuth authorize `req` (for the audit log). */
function clientIp(req: { headers?: Record<string, string> } | undefined): string | undefined {
  const fwd = req?.headers?.['x-forwarded-for']
  if (fwd) return fwd.split(',')[0].trim()
  return req?.headers?.['x-real-ip']
}

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

      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email.toLowerCase()
        const ip = clientIp(req)

        const user = await prisma.user.findUnique({
          where: { email },
          include: { garage: true },
        })

        if (!user) {
          // Unknown account — no garage context to audit; log without any PII in prod.
          logger.warn('[auth] Login attempt for unknown account')
          return null
        }

        const valid = await bcrypt.compare(credentials.password, user.password)

        if (!valid) {
          await logLogin({
            userId: user.id,
            userName: user.name ?? user.email,
            garageId: user.garageId,
            success: false,
            ipAddress: ip,
          })
          return null
        }

        await logLogin({
          userId: user.id,
          userName: user.name ?? user.email,
          garageId: user.garageId,
          success: true,
          ipAddress: ip,
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          garageId: user.garageId,
          garageName: user.garage.name,
          garageSlug: user.garage.slug,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.garageId = user.garageId
        token.garageName = user.garageName
        token.garageSlug = user.garageSlug
      }

      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.garageId = token.garageId
        session.user.garageName = token.garageName
        session.user.garageSlug = token.garageSlug
      }

      return session
    },
  },
}

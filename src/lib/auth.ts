import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
import { sessionRevalidationDecision } from '@/lib/users/session-revalidation'
import bcrypt from 'bcryptjs'

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
        // hashs. On ne trace que des événements non sensibles.
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email.toLowerCase()

        const user = await prisma.user.findUnique({
          where: {
            email,
          },
          include: {
            garage: true,
          },
        })

        if (!user) {
          return null
        }

        // Un compte non actif (suspendu / invitation non acceptée) ne peut pas
        // se connecter, même avec le bon mot de passe.
        if (user.status !== 'active') {
          return null
        }

        const valid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!valid) {
          return null
        }

        // Trace de dernière connexion (best-effort, jamais bloquant).
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {})

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          garageId: user.garageId,
          garageName: user.garage.name,
          garageSlug: user.garage.slug,
          sessionEpoch: user.sessionEpoch,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Émission à la connexion.
        token.id = user.id
        token.role = (user as any).role
        token.garageId = (user as any).garageId
        token.garageName = (user as any).garageName
        token.garageSlug = (user as any).garageSlug
        token.sessionEpoch = (user as any).sessionEpoch
        token.revoked = false
        return token
      }

      // Revalidation à CHAQUE requête suivante : un JWT autonome (30 j) doit
      // refléter une suspension, une révocation (sessionEpoch) ou un changement
      // de rôle sans attendre l'expiration. Fail-open sur erreur base.
      if (token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { status: true, sessionEpoch: true, role: true },
          })
          const decision = sessionRevalidationDecision({
            dbUser,
            tokenEpoch: token.sessionEpoch as number | undefined,
          })
          if (decision.revoked) {
            token.revoked = true
          } else {
            token.revoked = false
            if (decision.role) token.role = decision.role // propage le changement de rôle
          }
        } catch {
          // Erreur base (disponibilité) : conserver le token tel quel.
        }
      }

      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        if (token.revoked) {
          // Session révoquée : on retire le garageId → requireSession renvoie 401
          // (déconnexion effective au prochain appel protégé).
          session.user.role = ''
          session.user.garageId = ''
          return session
        }
        session.user.role = token.role as string
        session.user.garageId = token.garageId as string
        session.user.garageName = token.garageName as string
        session.user.garageSlug = token.garageSlug as string
      }

      return session
    },
  },
}
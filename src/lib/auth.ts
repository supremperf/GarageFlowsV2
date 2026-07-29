import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
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
        // SECURITY: never log the credentials object, the plaintext password,
        // or the stored bcrypt hash — Electron pipes stdout into log files that
        // ship in support/crash bundles. Log only the (lowercased) email and a
        // boolean outcome for diagnostics.
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
          console.warn('[auth] login failed — unknown email:', email)
          return null
        }

        const valid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!valid) {
          console.warn('[auth] login failed — bad password:', email)
          return null
        }

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
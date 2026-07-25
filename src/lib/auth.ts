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
        console.log('====================================')
        console.log('🔐 Nouvelle tentative de connexion')
        console.log('Credentials reçues :', credentials)
        console.log('====================================')

        if (!credentials?.email || !credentials?.password) {
          console.log('❌ Email ou mot de passe manquant')
          return null
        }

        const email = credentials.email.toLowerCase()

        console.log('📧 Email recherché :', email)

        const user = await prisma.user.findUnique({
          where: {
            email,
          },
          include: {
            garage: true,
          },
        })

        if (!user) {
          console.log('❌ Utilisateur introuvable')
          return null
        }

        console.log('✅ Utilisateur trouvé')
        console.log('Nom :', user.name)
        console.log('Email :', user.email)
        console.log('Rôle :', user.role)
        console.log('Garage :', user.garage?.name)
        console.log('Hash enregistré :', user.password)

        const valid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        console.log('🔑 Résultat bcrypt.compare :', valid)

        if (!valid) {
          console.log('❌ Mot de passe incorrect')
          return null
        }

        console.log('✅ Connexion autorisée')

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
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface User {
    id: string
    role: string
    garageId: string
    garageName: string
    garageSlug: string
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: string
      garageId: string
      garageName: string
      garageSlug: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: string
    garageId: string
    garageName: string
    garageSlug: string
  }
}

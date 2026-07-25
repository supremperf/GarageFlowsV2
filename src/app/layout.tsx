import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'GarageFlow — Planning Atelier Intelligent',
  description: 'Système de gestion et optimisation du planning de votre atelier automobile par intelligence artificielle.',
  keywords: ['garage', 'atelier', 'planning', 'mécanique', 'gestion', 'automobile'],
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

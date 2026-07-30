import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import PwaRegister from '@/components/PwaRegister'

export const metadata: Metadata = {
  title: 'GarageFlow — Planning Atelier Intelligent',
  description: 'Système de gestion et optimisation du planning de votre atelier automobile par intelligence artificielle.',
  keywords: ['garage', 'atelier', 'planning', 'mécanique', 'gestion', 'automobile'],
  manifest: '/manifest.webmanifest',
  applicationName: 'GarageFlow',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'GarageFlow' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  // Application privée : ne pas indexer.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1629',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import PWA from '@/components/pwa'
import { appleStartupImages } from '@/lib/pwaAssets'

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.garageflows.fr'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: 'GarageFlow',
  title: 'GarageFlow — Planning Atelier Intelligent',
  description:
    'Système de gestion et optimisation du planning de votre atelier automobile par intelligence artificielle.',
  keywords: ['garage', 'atelier', 'planning', 'mécanique', 'gestion', 'automobile'],
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'GarageFlow',
    statusBarStyle: 'black',
    startupImage: appleStartupImages,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1629',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
        {/* PWA : enregistrement du Service Worker, invite d'installation, raccourcis */}
        <PWA />
      </body>
    </html>
  )
}

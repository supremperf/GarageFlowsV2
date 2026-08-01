import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import PwaRegister from '@/components/PwaRegister'
import { BRAND } from '@/config/brand'

export const metadata: Metadata = {
  title: `${BRAND.productName} — ${BRAND.tagline}`,
  description: BRAND.tagline,
  keywords: ['garage', 'atelier', 'planning', 'mécanique', 'gestion', 'automobile'],
  manifest: '/manifest.webmanifest',
  applicationName: BRAND.productName,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: BRAND.productName },
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

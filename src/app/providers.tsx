'use client'

import { SessionProvider } from 'next-auth/react'
import { Toaster } from 'react-hot-toast'
import { LanguageProvider } from '@/lib/i18n'
import { EntitlementsProvider } from '@/lib/entitlements'
import NotificationCenter from '@/components/NotificationCenter'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <EntitlementsProvider>
        <LanguageProvider>
          {children}
        </LanguageProvider>
        {/* Centre de notifications (actif uniquement sous Electron) */}
        <NotificationCenter />
      </EntitlementsProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '10px',
            background: '#1e293b',
            color: '#f8fafc',
            fontSize: '13px',
            fontWeight: '500',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#f8fafc' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#f8fafc' } },
        }}
      />
    </SessionProvider>
  )
}


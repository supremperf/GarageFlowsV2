'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useScheduleStore } from '@/store/schedule-store'

/**
 * Applique les raccourcis du manifeste (`shortcuts`) et le paramètre `?action`.
 * L'app étant une SPA au niveau « / » (navigation par le store Zustand), on lit
 * le paramètre d'URL puis on ouvre le panneau correspondant via le store.
 * N'agit que sur la route « / » ; sans effet ailleurs (login, licence…).
 */
export default function PwaShortcutHandler() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname !== '/' || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const view = params.get('view')
    const action = params.get('action')
    if (!view && !action) return

    const store = useScheduleStore.getState()

    if (action === 'new-job') {
      store.openCreateModal?.()
    } else if (view === 'dashboard') {
      if (!store.isDashboardOpen) store.toggleDashboard?.()
    } else if (view === 'stock') {
      if (!store.isStockPanelOpen) store.toggleStockPanel?.()
    }
    // view === 'planning' → vue par défaut, rien à faire.

    // Nettoie l'URL pour éviter un re-déclenchement au rechargement.
    if (view || action) {
      params.delete('view')
      params.delete('action')
      const qs = params.toString()
      window.history.replaceState({}, '', qs ? `/?${qs}` : '/')
    }
  }, [pathname])

  return null
}

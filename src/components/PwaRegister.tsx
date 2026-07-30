'use client'

import { useEffect, useState } from 'react'

/**
 * Enregistrement du Service Worker (PWA) + gestion de mise à jour.
 *
 * NE s'enregistre PAS sous Electron (l'app desktop n'est pas une PWA et un SW y
 * interférerait). Uniquement en contexte web sécurisé (HTTPS / localhost).
 * Quand une nouvelle version du SW est prête, propose un rechargement contrôlé.
 */
function isElectron(): boolean {
  if (typeof window === 'undefined') return true
  return Boolean((window as unknown as { electronAPI?: unknown }).electronAPI)
}

export default function PwaRegister() {
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (isElectron()) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (!window.isSecureContext) return

    let cancelled = false
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Détecte l'arrivée d'un nouveau SW en attente.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller && !cancelled) {
              setUpdateReady(sw)
            }
          })
        })
      })
      .catch(() => {})

    // Recharge la page une fois le nouveau SW actif (évite les états incohérents).
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })

    return () => { cancelled = true }
  }, [])

  if (!updateReady) return null

  return (
    <div style={bar} role="status">
      <span style={{ fontSize: 13 }}>Une nouvelle version est disponible.</span>
      <button style={btn} onClick={() => updateReady.postMessage('SKIP_WAITING')}>
        Mettre à jour
      </button>
    </div>
  )
}

const bar: React.CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
  display: 'flex', alignItems: 'center', gap: 12, background: '#0f172a', color: '#f8fafc',
  border: '1px solid #1e293b', borderRadius: 12, padding: '10px 14px', boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
}
const btn: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

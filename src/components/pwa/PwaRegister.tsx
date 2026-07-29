'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Enregistre le Service Worker et gère les mises à jour automatiques.
 *
 *  - Enregistrement de /sw.js au chargement.
 *  - Détection d'une nouvelle version (worker en état « installed » alors qu'un
 *    contrôleur existe déjà) → bannière « Mise à jour disponible ».
 *  - Vérifications périodiques (toutes les heures) et au retour sur l'onglet.
 *  - Un clic sur « Mettre à jour » → SKIP_WAITING → rechargement automatique.
 */
export default function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [visible, setVisible] = useState(false)
  // Ne recharge la page que si l'utilisateur a explicitement accepté la mise à jour
  // (évite un rechargement parasite lors du premier `clients.claim()`).
  const acceptedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let reg: ServiceWorkerRegistration | undefined
    let refreshing = false

    const promptUpdate = (worker: ServiceWorker | null) => {
      if (!worker) return
      setWaitingWorker(worker)
      setVisible(true)
    }

    const onRegistered = (registration: ServiceWorkerRegistration) => {
      reg = registration

      // Une version déjà en attente ?
      if (registration.waiting && navigator.serviceWorker.controller) {
        promptUpdate(registration.waiting)
      }

      // Nouvelle version détectée pendant la session.
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate(registration.waiting || installing)
          }
        })
      })
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then(onRegistered)
      .catch((err) => console.error('[PWA] Échec enregistrement du Service Worker :', err))

    // Recharge une seule fois lorsque le nouveau SW prend le contrôle,
    // uniquement après acceptation explicite de la mise à jour.
    const onControllerChange = () => {
      if (refreshing || !acceptedRef.current) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Recherche de mises à jour : périodique + au retour de focus.
    const checkForUpdates = () => reg?.update().catch(() => {})
    const interval = window.setInterval(checkForUpdates, 60 * 60 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkForUpdates()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [])

  const applyUpdate = () => {
    setVisible(false)
    acceptedRef.current = true
    if (waitingWorker) {
      waitingWorker.postMessage('SKIP_WAITING')
    } else {
      window.location.reload()
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] flex justify-center p-4 pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[#161f38]/95 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">Mise à jour disponible</p>
          <p className="truncate text-xs text-slate-400">Une nouvelle version de GarageFlow est prête.</p>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          Plus tard
        </button>
        <button
          type="button"
          onClick={applyUpdate}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
        >
          Mettre à jour
        </button>
      </div>
    </div>
  )
}

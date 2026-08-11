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
  const [incompatible, setIncompatible] = useState<string | null>(null)

  /**
   * Contrôle de COMPATIBILITÉ avec le serveur.
   *
   * Une PWA restée en cache peut se retrouver à parler à une API dont le
   * contrat a changé : les écritures partent, le serveur les ignore ou les
   * rejette, et l'utilisateur ne voit rien. On interroge donc /api/version au
   * démarrage puis à chaque retour au premier plan (le seul moment où un
   * déploiement a pu avoir lieu sans que l'onglet le sache).
   */
  useEffect(() => {
    if (isElectron()) return
    let cancelled = false

    const check = () => {
      const version = process.env.NEXT_PUBLIC_GF_VERSION ?? ''
      fetch(`/api/version?client=pwa&version=${encodeURIComponent(version)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (cancelled || !info?.client?.compatibility) return
          const c = info.client.compatibility
          setIncompatible(c.status === 'incompatible' ? String(c.minimum ?? '') : null)
        })
        .catch(() => { /* hors ligne : on ne bloque jamais sur une absence de réponse */ })
    }

    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    if (isElectron()) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (!window.isSecureContext) return

    let cancelled = false
    // L'URL du worker porte la version applicative : à chaque release, le
    // navigateur voit une URL différente, ré-évalue le worker et déclenche
    // `updatefound`. Sans cela, un sw.js inchangé d'un octet ne provoquait
    // AUCUNE détection de mise à jour et le cache restait celui d'avant.
    const swUrl = `/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_GF_VERSION ?? 'dev')}`
    navigator.serviceWorker
      .register(swUrl)
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

  // L'incompatibilité prime sur la simple disponibilité d'une mise à jour :
  // continuer à travailler dans cet état produirait des écritures perdues.
  if (incompatible) {
    return (
      <div style={{ ...bar, borderColor: '#b91c1c' }} role="alert">
        <span style={{ fontSize: 13 }}>
          Cette version de GarageFlows n’est plus compatible avec le serveur
          (version {incompatible} minimum). Rechargez pour la mettre à jour.
        </span>
        <button style={btn} onClick={() => window.location.reload()}>Recharger</button>
      </div>
    )
  }

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

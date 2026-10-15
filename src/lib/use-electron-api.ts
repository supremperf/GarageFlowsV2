'use client'

import { useEffect, useState } from 'react'

/**
 * Accès au pont Electron (`window.electronAPI`) SANS casser l'hydratation.
 *
 * ── Pourquoi ce hook existe ──────────────────────────────────────────────────
 *
 * Le piège : lire `window` PENDANT le rendu.
 *
 *     const api = typeof window === 'undefined' ? null : window.electronAPI
 *     if (!api) return null          // ⛔ divergence serveur / client
 *
 * Le rendu serveur n'a pas de `window` : il produit `null`. Le PREMIER rendu
 * client, lui, voit déjà `window.electronAPI` sous Electron et produit l'UI
 * complète. React compare ce premier rendu au HTML reçu, constate qu'ils
 * diffèrent et lève :
 *   - #418 « Hydration failed because the initial UI does not match what was
 *     rendered on the server »
 *   - #423 — l'erreur survenant hors de toute frontière Suspense, React JETTE
 *     le HTML serveur et re-rend TOUTE la racine côté client.
 *
 * Le coût est réel : le bénéfice du rendu serveur est perdu à chaque démarrage,
 * l'écran peut clignoter, et les erreurs noient le journal (elles masquaient
 * d'autres diagnostics dans garageflow.log).
 *
 * ── La règle ─────────────────────────────────────────────────────────────────
 *
 * Le premier rendu client DOIT être identique au rendu serveur. Ce hook
 * renvoie donc `null` au premier rendu — comme le serveur — puis la vraie API
 * après montage, ce qui déclenche un re-rendu normal (et non une erreur).
 *
 * À utiliser partout où la présence d'Electron CHANGE CE QUI EST RENDU. Lire
 * `window` reste licite dans un `useEffect` ou un gestionnaire d'événement :
 * ces chemins s'exécutent après l'hydratation.
 */
export function useElectronApi<T = any>(): T | null {
  // Valeur initiale `null` = exactement ce que voit le rendu serveur.
  const [api, setApi] = useState<T | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setApi((((window as unknown as { electronAPI?: unknown }).electronAPI ?? null) as T | null))
  }, [])

  return api
}

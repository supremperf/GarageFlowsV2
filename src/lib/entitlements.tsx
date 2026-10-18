'use client'

/**
 * Droits (modules) côté renderer — UX uniquement.
 *
 * La SOURCE DE VÉRITÉ reste le serveur : `useModule()` sert à afficher/masquer,
 * mais l'autorisation réelle est décidée côté serveur (le processus principal
 * Electron reçoit la liste des modules via /api/license/check et la transmet
 * ici). En dehors d'Electron (web/dev), on est permissif — l'enforcement
 * effectif se fait de toute façon serveur.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useElectronApi } from '@/lib/use-electron-api'

interface EntitlementsValue {
  modules: string[]
  ready: boolean
  hasModule: (key: string) => boolean
}

const EntitlementsContext = createContext<EntitlementsValue | null>(null)

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  // Lu APRÈS montage (voir useElectronApi). `isElectron` ne change pas ce que
  // CE composant rend, mais il change ce que renvoie `hasModule()` — donc ce
  // que rendent ses descendants. Le lire pendant le rendu ferait diverger le
  // premier rendu client du HTML serveur dès le premier appelant de
  // `useModule()` (aucun aujourd'hui : le risque était latent).
  const api = useElectronApi<any>()
  const isElectron = !!api?.isElectron

  useEffect(() => {
    if (!api?.getEntitlements) {
      // Web/dev : pas de pont Electron → permissif (l'enforcement est serveur).
      setReady(true)
      return
    }
    let unsub: (() => void) | undefined
    api
      .getEntitlements()
      .then((r: { modules?: string[] }) => setModules(Array.isArray(r?.modules) ? r.modules : []))
      .catch(() => {})
      .finally(() => setReady(true))

    if (api.onEntitlements) {
      unsub = api.onEntitlements((info: { modules?: string[] }) => {
        setModules(Array.isArray(info?.modules) ? info.modules : [])
      })
    }
    return () => {
      if (unsub) unsub()
    }
    // `api` arrive APRÈS montage (null au premier rendu) : sans cette
    // dépendance, l'effet ne tournerait qu'avec api=null et les entitlements
    // ne seraient JAMAIS chargés sous Electron.
  }, [api])

  const value = useMemo<EntitlementsValue>(() => {
    const set = new Set(modules)
    return {
      modules,
      ready,
      // Hors Electron → permissif ; sous Electron → strictement la liste serveur.
      hasModule: (key: string) => (isElectron ? set.has(key) : true),
    }
  }, [modules, ready, isElectron])

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>
}

export function useEntitlements(): EntitlementsValue {
  const ctx = useContext(EntitlementsContext)
  if (!ctx) {
    // Utilisable hors provider (fallback permissif) pour ne jamais casser l'UI.
    return { modules: [], ready: true, hasModule: () => true }
  }
  return ctx
}

/** Raccourci : le module `key` est-il autorisé pour cette licence ? */
export function useModule(key: string): boolean {
  return useEntitlements().hasModule(key)
}

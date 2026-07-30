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

interface EntitlementsValue {
  modules: string[]
  ready: boolean
  hasModule: (key: string) => boolean
}

const EntitlementsContext = createContext<EntitlementsValue | null>(null)

function getElectronAPI(): any {
  if (typeof window === 'undefined') return null
  return (window as any).electronAPI ?? null
}

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const [modules, setModules] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!getElectronAPI()?.isElectron

  useEffect(() => {
    const api = getElectronAPI()
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
  }, [])

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

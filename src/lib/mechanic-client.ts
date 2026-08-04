'use client'

/**
 * Utilitaires client de l'espace mécanicien.
 *
 * Isolation par utilisateur : à la déconnexion (ou en cas de session invalide),
 * on PURGE tout le stockage local du navigateur pour ne jamais laisser les
 * données d'un mécanicien visibles au suivant sur le même appareil.
 */

export async function purgeLocalData(): Promise<void> {
  try { window.localStorage.clear() } catch { /* ignore */ }
  try { window.sessionStorage.clear() } catch { /* ignore */ }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch { /* ignore */ }
}

export async function mechanicLogout(): Promise<void> {
  try {
    await fetch('/api/mechanic/logout', { method: 'POST' })
  } catch { /* ignore */ }
  await purgeLocalData()
  window.location.href = '/license'
}

/** fetch JSON avec en-tête anti-cache ; redirige vers /license si la session tombe. */
export async function mechFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (res.status === 401) {
    await purgeLocalData()
    window.location.href = '/license'
    throw new Error('session expirée')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? 'Erreur')
  }
  return data as T
}

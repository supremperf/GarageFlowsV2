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
      // Le cache STATIQUE ne contient aucune donnée de mécanicien : il porte la
      // page hors ligne, le manifeste et les icônes. L'effacer avec le reste
      // supprimait `offline.html` — et le worker ne le reprécharge qu'à une
      // prochaine INSTALLATION. Un mécanicien qui se déconnecte puis perd le
      // réseau n'avait donc plus d'écran du tout, jusqu'à la version suivante.
      const prives = keys.filter((k) => !k.endsWith('-static'))
      await Promise.all(prives.map((k) => caches.delete(k)))
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

/**
 * Vrai dès qu'une redirection de session a été enclenchée.
 *
 * Plusieurs requêtes partent en parallèle (profil + planning). Sans ce verrou,
 * chacune déclenchait sa propre navigation, et les 401 concurrents se
 * relançaient mutuellement (GF-DUR-035).
 */
let redirectionEnCours = false

/**
 * Erreur d'API portant le STATUT HTTP.
 *
 * Reconnaître une panne à son libellé est fragile : le libellé change avec la
 * traduction, la reformulation, ou simplement la route. Le statut, lui, est un
 * contrat.
 */
export class ErreurMecanicien extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ErreurMecanicien'
    this.status = status
  }
}

/** fetch JSON avec en-tête anti-cache ; redirige vers /license si la session tombe. */
export async function mechFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (res.status === 401) {
    // ─── Pourquoi on EFFACE la session avant de partir ───────────────────────
    // Le cookie `gf_session` reste cryptographiquement valide alors que l'API
    // le refuse (clé révoquée, suspendue, expirée, réattribuée, ou licence
    // garage parente expirée). Le middleware, lui, ne voit que la signature :
    // il laissait donc l'appareil revenir sur /mechanic, qui rappelait l'API,
    // qui répondait 401… Mesuré : 737 requêtes/minute, écarts de ~140 ms.
    //
    // Se contenter de naviguer ne suffit pas : tant que le cookie est présenté,
    // la boucle peut se reformer. On demande donc au serveur de le retirer.
    if (!redirectionEnCours) {
      redirectionEnCours = true
      try { await fetch('/api/mechanic/logout', { method: 'POST' }) } catch { /* ignore */ }
      await purgeLocalData()
      window.location.href = '/license'
    }
    throw new Error('session expirée')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Le STATUT accompagne l'erreur. Sans lui, l'appelant en était réduit à
    // reconnaître la panne au TEXTE du message — et la détection du 404 dans
    // `use-mechanic-live` cherchait « introuvable / not found / 404 » alors que
    // les routes répondent « Intervention non accessible. ». Elle n'a donc
    // jamais rien détecté.
    throw new ErreurMecanicien((data as { error?: string }).error ?? 'Erreur', res.status)
  }
  return data as T
}

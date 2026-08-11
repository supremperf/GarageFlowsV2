'use client'

/**
 * Adaptateur React de la politique `lib/live-sync` pour l'espace MÉCANICIEN.
 *
 * Rend une donnée d'API « vivante » : elle se met à jour toute seule tant que
 * l'écran est visible, se met en veille en arrière-plan, et se resynchronise
 * IMMÉDIATEMENT au retour au premier plan ou du réseau.
 *
 * Hygiène (exigence « pas de fuite, pas de boucle ») :
 *  • un seul minuteur à la fois, toujours annulé au démontage ;
 *  • les écouteurs `visibilitychange` / `online` / `offline` sont retirés ;
 *  • un compteur de séquence ignore les réponses périmées (une réponse lente
 *    ne peut pas écraser une donnée plus récente) ;
 *  • aucune requête n'est lancée si la précédente est encore en vol.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { mechFetch } from '@/lib/mechanic-client'
import {
  initialLiveState, reduceLive, LIVE_BASE_INTERVAL_MS,
  type LiveEvent, type LiveState,
} from '@/lib/live-sync'

export interface MechanicLiveResult<T> {
  data: T | null
  error: string
  /** Vrai uniquement pendant le TOUT PREMIER chargement (évite le clignotement). */
  loading: boolean
  /** Horodatage du dernier succès — permet d'afficher « à jour ». */
  lastSyncAt: number | null
  /** Rafraîchissement explicite (après une action de l'utilisateur). */
  refresh: () => void
}

export function useMechanicLive<T>(
  url: string | null,
  options: {
    intervalMs?: number
    /** Appelé si la ressource n'est plus accessible (réaffectation, suppression). */
    onGone?: () => void
    enabled?: boolean
  } = {},
): MechanicLiveResult<T> {
  const { intervalMs = LIVE_BASE_INTERVAL_MS, onGone, enabled = true } = options

  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  const stateRef = useRef<LiveState>(initialLiveState({ baseIntervalMs: intervalMs }))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const seq = useRef(0)
  const mounted = useRef(true)
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  // `runRef` casse la dépendance circulaire entre `schedule` et `run` sans
  // recréer les callbacks à chaque rendu (source classique de doubles boucles).
  const runRef = useRef<() => void>(() => {})

  const schedule = useCallback(() => {
    clearTimer()
    if (!stateRef.current.polling) return
    timerRef.current = setTimeout(() => { runRef.current() }, stateRef.current.delayMs)
  }, [])

  const dispatch = useCallback((event: LiveEvent) => {
    stateRef.current = reduceLive(stateRef.current, event, { baseIntervalMs: intervalMs })
    if (stateRef.current.fetchNow) {
      stateRef.current = { ...stateRef.current, fetchNow: false }
      runRef.current()
    } else {
      schedule()
    }
  }, [intervalMs, schedule])

  const run = useCallback(async () => {
    if (!url || !enabled) return
    if (inFlight.current) return // jamais deux requêtes simultanées
    inFlight.current = true
    const mySeq = ++seq.current
    try {
      const result = await mechFetch<T>(url)
      if (!mounted.current || mySeq !== seq.current) return
      setData(result)
      setError('')
      setLastSyncAt(Date.now())
      stateRef.current = reduceLive(stateRef.current, 'success', { baseIntervalMs: intervalMs })
    } catch (e) {
      if (!mounted.current || mySeq !== seq.current) return
      const message = e instanceof Error ? e.message : 'Erreur réseau'
      // 404 = la ressource ne nous est plus attribuée (réaffectation à un autre
      // mécanicien, suppression). Ce n'est pas une panne : on prévient l'appelant.
      if (/introuvable|not found|404/i.test(message)) {
        onGoneRef.current?.()
      }
      setError(message)
      stateRef.current = reduceLive(stateRef.current, 'error', { baseIntervalMs: intervalMs })
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setLoading(false)
        schedule()
      }
    }
  }, [url, enabled, intervalMs, schedule])

  runRef.current = run

  // Démarrage / redémarrage quand l'URL change.
  useEffect(() => {
    mounted.current = true
    if (!url || !enabled) { setLoading(false); return }
    setLoading(true)
    stateRef.current = initialLiveState({ baseIntervalMs: intervalMs })
    dispatch('start')
    return () => { clearTimer() }
    // `dispatch` est stable (useCallback) ; l'effet ne se rejoue qu'à l'URL.
  }, [url, enabled, intervalMs, dispatch])

  // Démontage global : plus aucun minuteur, plus aucune réponse appliquée.
  useEffect(() => () => { mounted.current = false; clearTimer() }, [])

  // Visibilité et réseau — c'est ce qui garantit le rattrapage instantané.
  useEffect(() => {
    if (!url || !enabled) return
    const onVisibility = () => dispatch(document.visibilityState === 'visible' ? 'visible' : 'hidden')
    const onOnline = () => dispatch('online')
    const onOffline = () => dispatch('offline')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onOnline)
    }
  }, [url, enabled, dispatch])

  const refresh = useCallback(() => { dispatch('manual') }, [dispatch])

  return { data, error, loading, lastSyncAt, refresh }
}

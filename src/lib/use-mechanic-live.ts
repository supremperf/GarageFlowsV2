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
  /**
   * Échecs consécutifs de rafraîchissement — 0 quand tout va bien.
   *
   * Sert à DIRE que ce qui est affiché est peut-être périmé. Sans ce signal,
   * l'écran montrait un planning ancien avec l'assurance d'un planning à jour.
   */
  echecsConsecutifs: number
  /**
   * Écarte toute réponse encore en vol — à appeler AVANT une mutation, sans
   * quoi une lecture partie avant l'action peut revenir après et la défaire à
   * l'écran.
   */
  invalider: () => void
}

/**
 * Délai maximal accordé à une requête de la boucle.
 *
 * `inFlight` interdit deux appels simultanés, et il n'est relâché que dans le
 * `finally`. Une requête qui ne se résout JAMAIS — connexion ouverte puis
 * silencieuse, cas courant sur un réseau mobile qui bascule — laissait donc
 * `inFlight` à vrai pour toujours : plus aucun appel, plus aucune replanification.
 * La boucle mourait en silence, sans erreur affichée, et le mécanicien voyait un
 * planning figé qu'aucun geste ne ranimait.
 */
export const DELAI_REQUETE_MS = 20_000

/**
 * Rejette si la promesse n'a pas abouti dans le délai imparti.
 *
 * Exportée pour être ÉPROUVÉE : un garde-fou qu'aucun test ne peut exercer n'est
 * qu'une intention.
 */
export function avecDelaiBorne<T>(promesse: Promise<T>, ms = DELAI_REQUETE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error('Délai dépassé')), ms)
    promesse.then(
      (v) => { clearTimeout(minuteur); resolve(v) },
      (e) => { clearTimeout(minuteur); reject(e) },
    )
  })
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
  /**
   * Échecs consécutifs, EXPOSÉS.
   *
   * `LiveState` les portait déjà, mais ils restaient dans une ref : l'écran ne
   * pouvait donc pas dire que ce qu'il affiche est périmé. Un mécanicien voyait
   * un planning ancien avec l'assurance d'un planning à jour.
   */
  const [echecsConsecutifs, setEchecs] = useState(0)

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
      const result = await avecDelaiBorne(mechFetch<T>(url))
      if (!mounted.current || mySeq !== seq.current) return
      setData(result)
      setError('')
      setLastSyncAt(Date.now())
      setEchecs(0)
      stateRef.current = reduceLive(stateRef.current, 'success', { baseIntervalMs: intervalMs })
    } catch (e) {
      if (!mounted.current || mySeq !== seq.current) return
      const message = e instanceof Error ? e.message : 'Erreur réseau'
      // 404 = la ressource ne nous est plus attribuée (réaffectation à un autre
      // mécanicien, suppression). Ce n'est pas une panne : on prévient l'appelant.
      //
      // On décide sur le STATUT, pas sur le texte. La détection précédente
      // cherchait « introuvable / not found / 404 » dans le message, alors que
      // les routes répondent « Intervention non accessible. » : `onGone` n'a
      // donc JAMAIS été appelé, et un mécanicien dont l'intervention venait
      // d'être réaffectée restait sur un écran mort, à retenter indéfiniment.
      const statut = (e as { status?: unknown })?.status
      if (statut === 404 || /introuvable|not found|404/i.test(message)) {
        onGoneRef.current?.()
      }
      setError(message)
      setEchecs((n) => n + 1)
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
    return () => {
      clearTimer()
      // Toute réponse encore en vol appartient à l'URL PRÉCÉDENTE. Sans cette
      // invalidation, changer de jour appliquait à la nouvelle date la réponse
      // de l'ancienne : `mySeq !== seq.current` ne protégeait que des appels
      // concurrents DU MÊME url, jamais d'un changement d'url.
      //
      // La règle `exhaustive-deps` met en garde contre la lecture d'une ref au
      // nettoyage — elle vise les refs pointant un nœud du DOM. Ici c'est un
      // compteur, et c'est justement sa valeur À CET INSTANT qu'il faut
      // incrémenter : la copier en amont invaliderait la mauvaise génération.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++
      inFlight.current = false
    }
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

  /**
   * Écarte toute réponse encore en vol.
   *
   * À appeler AVANT une mutation : les actions du mécanicien (chrono,
   * commentaire, photo, checklist) ne passent pas par cette boucle. Une lecture
   * partie AVANT l'action pouvait donc revenir APRÈS et réafficher l'état
   * d'avant — l'écran reculait dans le temps sous les yeux de l'utilisateur, et
   * son geste semblait sans effet.
   */
  const invalider = useCallback(() => {
    seq.current++
    inFlight.current = false
  }, [])

  const refresh = useCallback(() => { dispatch('manual') }, [dispatch])

  return { data, error, loading, lastSyncAt, refresh, echecsConsecutifs, invalider }
}

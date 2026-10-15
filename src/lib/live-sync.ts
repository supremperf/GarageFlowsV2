/**
 * POLITIQUE DE SYNCHRONISATION « QUASI TEMPS RÉEL » — logique PURE.
 *
 * Contexte (audit du 2026-08-11) : GarageFlows ne possède AUCUN transport push
 * — ni SSE, ni WebSocket, ni Redis pub/sub, ni revalidation. La PWA mécanicien
 * chargeait son planning UNE SEULE FOIS au montage : une intervention créée ou
 * réaffectée par le garage n'apparaissait jamais sans rechargement manuel.
 *
 * Pourquoi un POLLING PILOTÉ plutôt qu'un SSE : l'application tourne à la fois
 * en serverless multi-instances (Vercel) et en processus unique (Electron). Un
 * SSE sans bus partagé ne délivrerait l'événement qu'aux clients connectés à
 * l'instance qui a traité l'écriture — donc pas de façon fiable. Un push robuste
 * exigerait une infrastructure (Redis/Ably) absente du projet. Le repli décrit
 * ici tient l'objectif de latence (< 3 s) sans nouvelle dépendance.
 *
 * Ce module ne contient QUE la décision : quand appeler, avec quel délai. Il
 * n'ouvre aucune connexion et ne touche pas au DOM — d'où sa testabilité.
 */

/** Cadence de rafraîchissement au premier plan (objectif : latence < 3 s). */
export const LIVE_BASE_INTERVAL_MS = 3_000
/** Plafond du délai après erreurs répétées (réseau coupé, serveur indisponible). */
export const LIVE_MAX_BACKOFF_MS = 30_000

export type LiveEvent =
  | 'start'    // montage du composant
  | 'success'  // réponse reçue
  | 'error'    // échec réseau/serveur
  | 'visible'  // l'onglet/l'app revient au premier plan
  | 'hidden'   // passage en arrière-plan
  | 'online'   // le réseau revient
  | 'offline'  // perte du réseau
  | 'manual'   // rafraîchissement demandé par l'utilisateur

export interface LiveState {
  /** Un prochain appel doit-il être programmé ? */
  polling: boolean
  /** Délai avant le prochain appel programmé. */
  delayMs: number
  /** Un appel doit-il partir IMMÉDIATEMENT (sans attendre le délai) ? */
  fetchNow: boolean
  /** Échecs consécutifs — pilote le backoff. */
  consecutiveErrors: number
}

export interface LiveOptions {
  baseIntervalMs?: number
  maxBackoffMs?: number
}

export function initialLiveState(opts: LiveOptions = {}): LiveState {
  return {
    polling: false,
    delayMs: opts.baseIntervalMs ?? LIVE_BASE_INTERVAL_MS,
    fetchNow: false,
    consecutiveErrors: 0,
  }
}

/**
 * Délai après `errors` échecs consécutifs : doublement borné.
 * 3 s → 6 s → 12 s → 24 s → 30 s (plafond). On ne martèle jamais un serveur
 * en difficulté, et on ne vide pas la batterie d'un téléphone hors couverture.
 */
export function backoffDelay(errors: number, opts: LiveOptions = {}): number {
  const base = opts.baseIntervalMs ?? LIVE_BASE_INTERVAL_MS
  const max = opts.maxBackoffMs ?? LIVE_MAX_BACKOFF_MS
  if (errors <= 0) return base
  return Math.min(base * Math.pow(2, errors), max)
}

/**
 * Transition de la politique. Déterministe et sans effet de bord : c'est le
 * seul endroit où se décide « quand rappeler le serveur ».
 *
 * Invariants garantis :
 *  • en arrière-plan ou hors ligne, AUCUN appel n'est programmé (pas de boucle
 *    qui tourne dans le vide, pas de reconnexion en rafale) ;
 *  • tout retour au premier plan ou du réseau déclenche un appel IMMÉDIAT et
 *    remet le délai à la cadence nominale — c'est ce qui fait apparaître sans
 *    délai une intervention créée pendant la coupure ;
 *  • un succès efface le backoff.
 */
export function reduceLive(state: LiveState, event: LiveEvent, opts: LiveOptions = {}): LiveState {
  const base = opts.baseIntervalMs ?? LIVE_BASE_INTERVAL_MS
  switch (event) {
    case 'start':
      return { polling: true, delayMs: base, fetchNow: true, consecutiveErrors: 0 }
    case 'success':
      return { ...state, delayMs: base, fetchNow: false, consecutiveErrors: 0 }
    case 'error': {
      const errors = state.consecutiveErrors + 1
      return { ...state, delayMs: backoffDelay(errors, opts), fetchNow: false, consecutiveErrors: errors }
    }
    case 'hidden':
    case 'offline':
      return { ...state, polling: false, fetchNow: false }
    case 'visible':
    case 'online':
      // Rattrapage immédiat : tout ce qui s'est passé pendant l'absence est
      // récupéré en une requête, sans attendre le prochain tick.
      return { polling: true, delayMs: base, fetchNow: true, consecutiveErrors: 0 }
    case 'manual':
      return { ...state, fetchNow: true }
    default:
      return state
  }
}

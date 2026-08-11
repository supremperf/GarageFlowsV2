/**
 * CONTRAT de synchronisation des interventions POSTE ⇄ CLOUD — logique PURE.
 *
 * ─── Le défaut résolu ───────────────────────────────────────────────────────
 * Le poste écrit dans SQLite, la PWA lit PostgreSQL (cf. src/lib/db.ts) et rien
 * ne reliait les deux pour les interventions : seules l'identité mécanicien et
 * les instantanés portail remontaient. Mesuré le 2026-08-11 sur la base réelle :
 * 30 interventions côté poste, 0 pour le mécanicien miroir côté cloud. La tâche
 * affectée depuis le PC ne pouvait donc PAS apparaître dans la PWA — aucun
 * réglage de rafraîchissement n'y aurait changé quoi que ce soit.
 *
 * ─── Qui décide de quoi (résolution de conflit, cf. §49) ────────────────────
 * Un simple « dernier écrit gagne » sur l'enregistrement entier laisserait le
 * poste écraser, à sa prochaine remontée, le chrono ou le statut que le
 * mécanicien vient de changer. On sépare donc les champs en deux familles :
 *
 *   PLANIFICATION (le garage décide)  : date, heure, durée estimée, type,
 *     urgence, véhicule, plaque, client, notes de planning, AFFECTATION.
 *   EXÉCUTION (le mécanicien décide)  : statut, chrono, durée réelle, retard.
 *
 * La planification est toujours appliquée depuis le poste. L'exécution n'est
 * appliquée que si la version du poste est au moins aussi récente que celle du
 * cloud — sinon la valeur du mécanicien est conservée ET renvoyée au poste.
 *
 * Aucune donnée financière (prix, marge, facture) ne transite : la PWA
 * mécanicien n'en a pas l'usage et ne doit pas y avoir accès.
 */

/** Champs pilotés par le garage — écrasés à chaque remontée du poste. */
export const PLANNING_FIELDS = [
  'customerName', 'vehicleModel', 'licensePlate', 'repairType',
  'estimatedDuration', 'startTime', 'date', 'notes', 'isUrgent', 'mechanicId',
] as const

/** Champs pilotés par le mécanicien — conservés si le cloud est plus récent. */
export const EXECUTION_FIELDS = [
  'status', 'actualDuration', 'delayMinutes', 'timerStartedAt', 'timerAccumulatedSec',
] as const

export type PlanningField = (typeof PLANNING_FIELDS)[number]
export type ExecutionField = (typeof EXECUTION_FIELDS)[number]

/** Représentation transportée d'une intervention (aucun champ financier). */
export interface SyncJob {
  id: string
  customerName: string
  vehicleModel: string
  licensePlate: string | null
  repairType: string
  estimatedDuration: number
  actualDuration: number | null
  startTime: string
  date: string
  status: string
  notes: string | null
  isUrgent: boolean
  delayMinutes: number | null
  timerStartedAt: string | null
  timerAccumulatedSec: number
  mechanicId: string
  /** Horodatage de la dernière modification CÔTÉ POSTE (ISO). */
  updatedAt: string
}

/**
 * Que faut-il écrire dans le miroir cloud ?
 *
 * @param incoming  intervention telle que le poste la connaît
 * @param mirrorUpdatedAt `updatedAt` du miroir cloud (null si absent)
 * @returns le sous-ensemble de champs à appliquer
 */
export function resolveMirrorWrite(
  incoming: SyncJob,
  mirrorUpdatedAt: Date | null,
): { fields: Array<PlanningField | ExecutionField>; executionKept: boolean } {
  const fields: Array<PlanningField | ExecutionField> = [...PLANNING_FIELDS]
  if (mirrorUpdatedAt === null) {
    // Création : tout vient du poste.
    return { fields: [...fields, ...EXECUTION_FIELDS], executionKept: false }
  }
  const desktopAt = Date.parse(incoming.updatedAt)
  const cloudAt = mirrorUpdatedAt.getTime()
  // `>=` : à horodatage égal, le poste fait foi (il est la source de vérité du
  // dossier). Strictement plus récent côté cloud = le mécanicien a agi après.
  if (Number.isFinite(desktopAt) && desktopAt >= cloudAt) {
    return { fields: [...fields, ...EXECUTION_FIELDS], executionKept: false }
  }
  return { fields, executionKept: true }
}

/**
 * Que faut-il réappliquer sur le POSTE à partir du miroir cloud ?
 * Uniquement l'exécution, et uniquement si le cloud est strictement plus récent.
 */
export function shouldApplyCloudExecution(
  localUpdatedAt: Date,
  cloudUpdatedAt: Date,
): boolean {
  return cloudUpdatedAt.getTime() > localUpdatedAt.getTime()
}

/** Fenêtre de synchronisation : les interventions utiles au mécanicien. */
export const SYNC_WINDOW_DAYS_BACK = 7
export const SYNC_WINDOW_DAYS_AHEAD = 30

/** Borne le nombre d'interventions transportées en une remontée. */
export const SYNC_MAX_JOBS = 500

export function syncWindow(today: Date): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - SYNC_WINDOW_DAYS_BACK)
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + SYNC_WINDOW_DAYS_AHEAD)
  return { from: iso(from), to: iso(to) }
}

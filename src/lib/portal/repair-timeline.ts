/**
 * Repair-tracking timeline (Phase 2 — « Suivi des réparations »).
 *
 * Maps a job's real status to an ordered, human-readable progress timeline:
 *   Réception → Diagnostic → Commande pièces → Réparation → Contrôle qualité
 *   → Prêt → Livré
 * Pure and deterministic — the current stage is derived from the stored status,
 * never invented. Stages before the current one are `done`, the rest `pending`.
 */

export type TimelineState = 'done' | 'current' | 'pending' | 'cancelled'

export interface TimelineStage {
  key: string
  label: string
  state: TimelineState
}

const STAGES: { key: string; label: string }[] = [
  { key: 'reception', label: 'Réception' },
  { key: 'diagnostic', label: 'Diagnostic' },
  { key: 'parts', label: 'Commande pièces' },
  { key: 'repair', label: 'Réparation' },
  { key: 'quality', label: 'Contrôle qualité' },
  { key: 'ready', label: 'Prêt' },
  { key: 'delivered', label: 'Livré' },
]

/** Map a stored job status to the index of the reached stage. */
export function stageIndexForStatus(status: string): number {
  switch (status) {
    case 'scheduled':
      return 0
    case 'in_progress':
    case 'delayed':
      return 3
    case 'done':
    case 'completed':
      return 5
    case 'delivered':
      return 6
    default:
      return 0
  }
}

export interface RepairTimeline {
  currentIndex: number
  cancelled: boolean
  stages: TimelineStage[]
}

/** Build the full timeline for a job status. */
export function repairTimeline(status: string): RepairTimeline {
  const cancelled = status === 'cancelled'
  const currentIndex = cancelled ? -1 : stageIndexForStatus(status)

  const stages: TimelineStage[] = STAGES.map((s, i) => {
    let state: TimelineState
    if (cancelled) state = 'cancelled'
    else if (i < currentIndex) state = 'done'
    else if (i === currentIndex) state = 'current'
    else state = 'pending'
    return { key: s.key, label: s.label, state }
  })

  return { currentIndex, cancelled, stages }
}

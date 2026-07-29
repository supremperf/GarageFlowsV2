/**
 * Intelligent scheduling — shared types.
 *
 * A deterministic two-resource assignment: each job needs a MECHANIC and a BAY
 * (lift). Times are minutes-from-midnight. The optimizer proposes a schedule;
 * the user keeps final control.
 */

export interface SchedMechanic {
  id: string
  name: string
  /** Skills the mechanic can perform. Empty = generalist (can do anything). */
  skills?: string[]
  /** Availability window (minutes). Defaults to the day window. */
  availableFrom?: number
  availableTo?: number
  absent?: boolean
}

export interface SchedJob {
  id: string
  label?: string
  durationMin: number
  /** Required skill; a mechanic must have it (or be a generalist). */
  requiredSkill?: string
  urgent?: boolean
  /** Higher = scheduled earlier (after urgency). Default 0. */
  priority?: number
  /** Earliest allowed start (minutes). */
  earliestStart?: number
  /** Force a specific mechanic. */
  fixedMechanicId?: string
}

export interface SchedOptions {
  /** Working day window (minutes). Default 8:00–18:00. */
  dayStart?: number
  dayEnd?: number
  /** Number of bays/lifts. Default 2. */
  bays?: number
}

export interface Assignment {
  jobId: string
  label?: string
  mechanicId: string
  mechanicName: string
  bay: number
  start: number
  end: number
}

export interface Unscheduled {
  jobId: string
  label?: string
  reason: 'no_eligible_mechanic' | 'no_slot'
}

export interface ScheduleMetrics {
  makespan: number
  scheduledCount: number
  unscheduledCount: number
  /** Per-mechanic busy minutes. */
  loadByMechanic: Array<{ mechanicId: string; name: string; busyMin: number; utilizationPct: number }>
  /** Std-dev of mechanic busy minutes (lower = better balanced). */
  balanceStdDev: number
}

export interface ScheduleResult {
  assignments: Assignment[]
  unscheduled: Unscheduled[]
  metrics: ScheduleMetrics
}

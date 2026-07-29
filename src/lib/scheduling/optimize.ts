/**
 * Intelligent scheduler — deterministic greedy two-resource assignment.
 *
 * Jobs are placed in priority order; each is assigned to the (mechanic, bay)
 * pair that yields the EARLIEST feasible start, breaking ties toward the
 * least-loaded mechanic (load balancing) then the lowest bay index. Respects
 * skills, availability windows, the working day and bay capacity.
 */
import type {
  Assignment,
  ScheduleMetrics,
  ScheduleResult,
  SchedJob,
  SchedMechanic,
  SchedOptions,
  Unscheduled,
} from './types'

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.round(Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) * 10) / 10
}

function eligible(mech: SchedMechanic, job: SchedJob): boolean {
  if (mech.absent) return false
  if (job.fixedMechanicId && mech.id !== job.fixedMechanicId) return false
  if (job.requiredSkill && mech.skills && mech.skills.length > 0) {
    return mech.skills.includes(job.requiredSkill)
  }
  return true
}

export function optimizeSchedule(
  jobs: SchedJob[],
  mechanics: SchedMechanic[],
  options: SchedOptions = {},
): ScheduleResult {
  const dayStart = options.dayStart ?? 8 * 60
  const dayEnd = options.dayEnd ?? 18 * 60
  const bayCount = Math.max(1, options.bays ?? 2)

  const active = mechanics.filter((m) => !m.absent)
  const winStart = (m: SchedMechanic) => Math.max(dayStart, m.availableFrom ?? dayStart)
  const winEnd = (m: SchedMechanic) => Math.min(dayEnd, m.availableTo ?? dayEnd)

  const mechFree = new Map<string, number>()
  const mechLoad = new Map<string, number>()
  for (const m of active) {
    mechFree.set(m.id, winStart(m))
    mechLoad.set(m.id, 0)
  }
  const bayFree = new Array(bayCount).fill(dayStart)

  const sorted = [...jobs].sort((a, b) => {
    if (!!b.urgent !== !!a.urgent) return b.urgent ? 1 : -1
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    if ((a.earliestStart ?? 0) !== (b.earliestStart ?? 0)) return (a.earliestStart ?? 0) - (b.earliestStart ?? 0)
    if (b.durationMin !== a.durationMin) return b.durationMin - a.durationMin
    return a.id.localeCompare(b.id)
  })

  const assignments: Assignment[] = []
  const unscheduled: Unscheduled[] = []

  for (const job of sorted) {
    const elig = active.filter((m) => eligible(m, job))
    if (elig.length === 0) {
      unscheduled.push({ jobId: job.id, label: job.label, reason: 'no_eligible_mechanic' })
      continue
    }

    let best: { start: number; mech: SchedMechanic; bay: number } | null = null
    for (const m of elig) {
      const earliest = Math.max(mechFree.get(m.id)!, winStart(m), job.earliestStart ?? 0)
      for (let bay = 0; bay < bayCount; bay++) {
        const start = Math.max(earliest, bayFree[bay])
        const end = start + job.durationMin
        if (end > winEnd(m)) continue
        if (
          best === null ||
          start < best.start ||
          (start === best.start && mechLoad.get(m.id)! < mechLoad.get(best.mech.id)!) ||
          (start === best.start && mechLoad.get(m.id)! === mechLoad.get(best.mech.id)! && bay < best.bay)
        ) {
          best = { start, mech: m, bay }
        }
      }
    }

    if (!best) {
      unscheduled.push({ jobId: job.id, label: job.label, reason: 'no_slot' })
      continue
    }

    const end = best.start + job.durationMin
    mechFree.set(best.mech.id, end)
    mechLoad.set(best.mech.id, mechLoad.get(best.mech.id)! + job.durationMin)
    bayFree[best.bay] = end
    assignments.push({
      jobId: job.id,
      label: job.label,
      mechanicId: best.mech.id,
      mechanicName: best.mech.name,
      bay: best.bay,
      start: best.start,
      end,
    })
  }

  // Metrics.
  const loadByMechanic = active.map((m) => {
    const busy = mechLoad.get(m.id) ?? 0
    const windowLen = Math.max(1, winEnd(m) - winStart(m))
    return { mechanicId: m.id, name: m.name, busyMin: busy, utilizationPct: Math.round((busy / windowLen) * 100) }
  })
  const starts = assignments.map((a) => a.start)
  const ends = assignments.map((a) => a.end)
  const makespan = assignments.length ? Math.max(...ends) - Math.min(...starts) : 0

  const metrics: ScheduleMetrics = {
    makespan,
    scheduledCount: assignments.length,
    unscheduledCount: unscheduled.length,
    loadByMechanic,
    balanceStdDev: stddev(loadByMechanic.map((l) => l.busyMin)),
  }

  return { assignments, unscheduled, metrics }
}

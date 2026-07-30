/**
 * Garage memory — derive insights from intervention history. Pure & deterministic.
 */
import type { InterventionRecord, MemoryInsight, MemoryResult, Severity } from './types'

function mean(xs: number[]): number {
  return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0
}

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

export function analyzeMemory(records: InterventionRecord[]): MemoryResult {
  const insights: MemoryInsight[] = []

  const plateVisits = new Map<string, number>()
  const plateRepair = new Map<string, { plate: string; repairType: string; count: number }>()
  const partRefPlate = new Map<string, { plateCounts: Map<string, number>; total: number }>()
  const typeDurations = new Map<string, { all: number[]; byMech: Map<string, number[]> }>()
  const typeSatisfaction = new Map<string, number[]>()

  for (const r of records) {
    const plate = r.vehiclePlate?.trim()
    const type = r.repairType?.trim()
    if (plate) plateVisits.set(plate, (plateVisits.get(plate) ?? 0) + 1)
    if (plate && type) {
      const key = `${plate}|${type}`
      const cur = plateRepair.get(key) ?? { plate, repairType: type, count: 0 }
      cur.count += 1
      plateRepair.set(key, cur)
    }
    for (const p of r.parts ?? []) {
      const ref = p.reference?.trim()
      if (!ref) continue
      const entry = partRefPlate.get(ref) ?? { plateCounts: new Map<string, number>(), total: 0 }
      entry.total += 1
      if (plate) entry.plateCounts.set(plate, (entry.plateCounts.get(plate) ?? 0) + 1)
      partRefPlate.set(ref, entry)
    }
    if (type && r.actualMinutes != null && r.actualMinutes > 0) {
      const td = typeDurations.get(type) ?? { all: [], byMech: new Map<string, number[]>() }
      td.all.push(r.actualMinutes)
      if (r.mechanicName) {
        const arr = td.byMech.get(r.mechanicName) ?? []
        arr.push(r.actualMinutes)
        td.byMech.set(r.mechanicName, arr)
      }
      typeDurations.set(type, td)
    }
    if (type && r.satisfaction != null) {
      const arr = typeSatisfaction.get(type) ?? []
      arr.push(r.satisfaction)
      typeSatisfaction.set(type, arr)
    }
  }

  // 1. Recurring fault on a vehicle.
  for (const { plate, repairType, count } of Array.from(plateRepair.values())) {
    if (count < 2) continue
    insights.push({
      type: 'recurring_fault',
      severity: count >= 3 ? 'high' : 'medium',
      confidence: count >= 3 ? 'high' : 'medium',
      title: 'Panne récurrente',
      message: `Le véhicule ${plate} est déjà venu ${count} fois pour « ${repairType} ».`,
      ref: { plate, repairType },
      metric: { count },
    })
  }

  // 2. Frequent vehicle (loyal / heavy user).
  for (const [plate, visits] of Array.from(plateVisits)) {
    if (visits < 3) continue
    insights.push({
      type: 'frequent_vehicle',
      severity: 'medium',
      confidence: 'medium',
      title: 'Véhicule habitué',
      message: `Le véhicule ${plate} est un habitué (${visits} passages).`,
      ref: { plate },
      metric: { visits },
    })
  }

  // 3. Part reliability (refitted on the same vehicle → possible defect).
  for (const [ref, entry] of Array.from(partRefPlate)) {
    let worstPlate = ''
    let worstCount = 0
    for (const [plate, c] of Array.from(entry.plateCounts)) {
      if (c > worstCount) { worstCount = c; worstPlate = plate }
    }
    if (worstCount >= 2 && entry.total >= 2) {
      insights.push({
        type: 'part_reliability',
        severity: worstCount >= 3 ? 'high' : 'medium',
        confidence: 'medium',
        title: 'Fiabilité de pièce',
        message: `La référence ${ref} a été reposée ${worstCount} fois sur le véhicule ${worstPlate} — fiabilité à surveiller.`,
        ref: { partRef: ref, plate: worstPlate },
        metric: { repeat: worstCount, total: entry.total },
      })
    }
  }

  // 4. Repair speed — a mechanic notably faster than the type average.
  for (const [repairType, td] of Array.from(typeDurations)) {
    if (td.all.length < 3) continue
    const typeAvg = mean(td.all)
    let fastestMech = ''
    let fastestAvg = Infinity
    for (const [mech, arr] of Array.from(td.byMech)) {
      if (arr.length < 2) continue
      const a = mean(arr)
      if (a < fastestAvg) { fastestAvg = a; fastestMech = mech }
    }
    if (fastestMech && fastestAvg <= typeAvg * 0.8) {
      insights.push({
        type: 'repair_speed',
        severity: 'low',
        confidence: 'medium',
        title: 'Méthode plus rapide',
        message: `Pour « ${repairType} », ${fastestMech} est en moyenne plus rapide (${fastestAvg} min contre ${typeAvg} min de moyenne).`,
        ref: { repairType, mechanicName: fastestMech },
        metric: { mechAvg: fastestAvg, typeAvg },
      })
    }
  }

  // 5. Low satisfaction on a repair type.
  for (const [repairType, arr] of Array.from(typeSatisfaction)) {
    if (arr.length < 2) continue
    const avg = mean(arr)
    if (avg < 3) {
      insights.push({
        type: 'low_satisfaction',
        severity: 'high',
        confidence: 'medium',
        title: 'Satisfaction faible',
        message: `La satisfaction sur « ${repairType} » est faible (${avg}/5) sur ${arr.length} intervention(s).`,
        ref: { repairType },
        metric: { avg, count: arr.length },
      })
    }
  }

  insights.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

  return {
    insights,
    summary: {
      interventions: records.length,
      vehicles: plateVisits.size,
      repairTypes: new Set(records.map((r) => r.repairType).filter(Boolean)).size,
    },
  }
}

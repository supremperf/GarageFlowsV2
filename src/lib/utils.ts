import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Job, Mechanic, RepairType, REPAIR_TYPES, WORKSHOP_START_HOUR, WORKSHOP_END_HOUR } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function getJobEndTime(job: Job): string {
  const startMinutes = timeToMinutes(job.startTime)
  const duration = job.delayMinutes
    ? job.estimatedDuration + job.delayMinutes
    : job.estimatedDuration
  return minutesToTime(startMinutes + duration)
}

export function jobsOverlap(a: Job, b: Job): boolean {
  if (a.mechanicId !== b.mechanicId || a.date !== b.date || a.id === b.id) return false
  const aStart = timeToMinutes(a.startTime)
  // Use the SAME effective end as getJobEndTime / slot-finding (include
  // delayMinutes) — otherwise overlaps caused by delayed jobs went undetected.
  const aEnd = aStart + a.estimatedDuration + (a.delayMinutes || 0)
  const bStart = timeToMinutes(b.startTime)
  const bEnd = bStart + b.estimatedDuration + (b.delayMinutes || 0)
  return aStart < bEnd && bStart < aEnd
}

export function estimateRepairDuration(
  repairType: RepairType,
  vehicleModel: string,
  historicalData: Job[]
): number {
  const config = REPAIR_TYPES[repairType]
  const base = config.defaultDuration

  // Find historical jobs of same type
  const similar = historicalData.filter(
    j => j.repairType === repairType && j.status === 'completed' && j.actualDuration
  )

  if (similar.length === 0) return base

  // Weight by vehicle similarity
  const vehicleBrand = vehicleModel.toLowerCase().split(' ')[0]
  const sameBrand = similar.filter(j =>
    j.vehicleModel.toLowerCase().startsWith(vehicleBrand)
  )

  const sample = sameBrand.length >= 3 ? sameBrand : similar
  const avg = sample.reduce((sum, j) => sum + (j.actualDuration || base), 0) / sample.length

  // Blend: 70% historical, 30% default
  return Math.round(avg * 0.7 + base * 0.3)
}

export function findAvailableSlots(
  mechanicId: string,
  jobs: Job[],
  date: string,
  duration: number,
  workshopStartHour = WORKSHOP_START_HOUR,
  workshopEndHour   = WORKSHOP_END_HOUR,
): string[] {
  const workshopStart = workshopStartHour * 60
  const workshopEnd = workshopEndHour * 60

  const mechanicJobs = jobs
    .filter(j => j.mechanicId === mechanicId && j.date === date && j.status !== 'cancelled')
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

  const available: string[] = []
  let cursor = workshopStart

  for (const job of mechanicJobs) {
    const jobStart = timeToMinutes(job.startTime)
    const jobEnd = jobStart + (job.estimatedDuration + (job.delayMinutes || 0))

    if (jobStart - cursor >= duration) {
      available.push(minutesToTime(cursor))
    }
    cursor = Math.max(cursor, jobEnd)
  }

  if (workshopEnd - cursor >= duration) {
    available.push(minutesToTime(cursor))
  }

  return available
}

export function findBestSlot(
  jobs: Job[],
  mechanics: Mechanic[],
  date: string,
  duration: number,
  workshopStartHour = WORKSHOP_START_HOUR,
  workshopEndHour   = WORKSHOP_END_HOUR,
): { mechanicId: string; startTime: string } | null {
  const activeMechanics = mechanics.filter(m => !m.isAbsent)
  let bestSlot: { mechanicId: string; startTime: string; startMinutes: number } | null = null

  for (const mechanic of activeMechanics) {
    const slots = findAvailableSlots(mechanic.id, jobs, date, duration, workshopStartHour, workshopEndHour)
    for (const slot of slots) {
      const slotMinutes = timeToMinutes(slot)
      if (!bestSlot || slotMinutes < bestSlot.startMinutes) {
        bestSlot = { mechanicId: mechanic.id, startTime: slot, startMinutes: slotMinutes }
      }
    }
  }

  return bestSlot ? { mechanicId: bestSlot.mechanicId, startTime: bestSlot.startTime } : null
}

export function detectEmptySlots(
  jobs: Job[],
  mechanics: Mechanic[],
  date: string,
  workshopStartHour = WORKSHOP_START_HOUR,
  workshopEndHour   = WORKSHOP_END_HOUR,
): { mechanicId: string; startTime: string; duration: number }[] {
  const workshopStart = workshopStartHour * 60
  const workshopEnd = workshopEndHour * 60
  const gaps: { mechanicId: string; startTime: string; duration: number }[] = []

  for (const mechanic of mechanics.filter(m => !m.isAbsent)) {
    const mechanicJobs = jobs
      .filter(j => j.mechanicId === mechanic.id && j.date === date && j.status !== 'cancelled')
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

    let cursor = workshopStart

    for (const job of mechanicJobs) {
      const jobStart = timeToMinutes(job.startTime)
      const gap = jobStart - cursor
      if (gap >= 15) {
        gaps.push({ mechanicId: mechanic.id, startTime: minutesToTime(cursor), duration: gap })
      }
      cursor = Math.max(cursor, jobStart + job.estimatedDuration + (job.delayMinutes || 0))
    }

    const finalGap = workshopEnd - cursor
    if (finalGap >= 15) {
      gaps.push({ mechanicId: mechanic.id, startTime: minutesToTime(cursor), duration: finalGap })
    }
  }

  return gaps
}

export function calculateUtilizationRate(
  jobs: Job[],
  mechanics: Mechanic[],
  date: string,
  workshopStartHour = WORKSHOP_START_HOUR,
  workshopEndHour   = WORKSHOP_END_HOUR,
): number {
  const activeMechanics = mechanics.filter(m => !m.isAbsent)
  if (activeMechanics.length === 0) return 0

  const workshopDuration = (workshopEndHour - workshopStartHour) * 60
  // Garde : heures d'atelier égales/inversées → capacité 0 → division par zéro
  // (taux affiché à 100 % ou NaN sur une config invalide).
  if (workshopDuration <= 0) return 0
  const totalCapacity = workshopDuration * activeMechanics.length

  const filledMinutes = jobs
    .filter(j => j.date === date && j.status !== 'cancelled')
    .reduce((sum, j) => sum + j.estimatedDuration, 0)

  return Math.min(100, Math.round((filledMinutes / totalCapacity) * 100))
}

export function getStatusColor(status: Job['status']): string {
  const colors: Record<Job['status'], string> = {
    scheduled: '#3b82f6',
    in_progress: '#10b981',
    awaiting_validation: '#a855f7',
    completed: '#6b7280',
    delayed: '#f59e0b',
    cancelled: '#ef4444',
  }
  return colors[status]
}

export function getStatusLabel(status: Job['status']): string {
  const labels: Record<Job['status'], string> = {
    scheduled: 'Planifié',
    in_progress: 'En cours',
    awaiting_validation: 'En attente de validation',
    completed: 'Terminé',
    delayed: 'En retard',
    cancelled: 'Annulé',
  }
  return labels[status]
}

/**
 * Format compact pour les cartes/badges denses : « 45 min », « 1h30 », « 2h ».
 * (Espace ajouté après les minutes seules pour la lisibilité — plus de « 45min ».)
 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm > 0 ? `${h}h${String(mm).padStart(2, '0')}` : `${h}h`
}

/**
 * Format long et lisible pour les textes (alertes IA, phrases) :
 *   45  → « 45 min »
 *   376 → « 6 h 16 »
 *   489 → « 8 h 09 »
 *   600 → « 10 h »
 * Évite les chaînes collées type « 376min » / « 600min ».
 */
export function formatDurationLong(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm > 0 ? `${h} h ${String(mm).padStart(2, '0')}` : `${h} h`
}

export function getTodayString(): string {
  // Use the LOCAL calendar day, not UTC. toISOString() emits UTC, so in France
  // (UTC+1/+2) evenings rolled to the next day, defaulting new jobs to tomorrow
  // and disagreeing with the money routes (which use local yyyy-MM-dd).
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

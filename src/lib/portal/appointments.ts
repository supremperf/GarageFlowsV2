/**
 * Appointment booking logic (Phase 2). Pure and unit-tested.
 *
 * Validates a requested slot (format, future, within workshop hours, fits before
 * closing) and models the status lifecycle: requested → confirmed → completed,
 * with cancellation allowed from requested/confirmed.
 */

export type AppointmentStatus = 'requested' | 'confirmed' | 'cancelled' | 'completed'
export type AppointmentAction = 'confirm' | 'cancel' | 'complete'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface SlotInput {
  date: string // YYYY-MM-DD
  startTime: string // HH:MM
  durationMin: number
  workshopStartHour: number
  workshopEndHour: number
  now?: Date
}

export interface SlotValidation {
  ok: boolean
  error?: string
}

/** Validate a requested appointment slot. */
export function validateSlot(input: SlotInput): SlotValidation {
  const { date, startTime, durationMin, workshopStartHour, workshopEndHour } = input
  const now = input.now ?? new Date()

  if (!DATE_RE.test(date)) return { ok: false, error: 'Date invalide (AAAA-MM-JJ attendu).' }
  const timeMatch = TIME_RE.exec(startTime)
  if (!timeMatch) return { ok: false, error: 'Heure invalide (HH:MM attendu).' }
  if (!Number.isFinite(durationMin) || durationMin <= 0) return { ok: false, error: 'Durée invalide.' }

  const startMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2])
  const endMinutes = startMinutes + durationMin
  if (startMinutes < workshopStartHour * 60) return { ok: false, error: 'Créneau avant l’ouverture de l’atelier.' }
  if (endMinutes > workshopEndHour * 60) return { ok: false, error: 'Créneau après la fermeture de l’atelier.' }

  const slot = new Date(`${date}T${startTime}:00`)
  if (Number.isNaN(slot.getTime())) return { ok: false, error: 'Date/heure invalide.' }
  if (slot.getTime() <= now.getTime()) return { ok: false, error: 'Le créneau doit être dans le futur.' }

  return { ok: true }
}

/** Whether an appointment can still be modified/cancelled by the client. */
export function canModifyAppointment(status: AppointmentStatus): boolean {
  return status === 'requested' || status === 'confirmed'
}

/** Compute the next status for an appointment action, or null if not allowed. */
export function nextAppointmentStatus(current: AppointmentStatus, action: AppointmentAction): AppointmentStatus | null {
  switch (action) {
    case 'confirm':
      return current === 'requested' ? 'confirmed' : null
    case 'cancel':
      return canModifyAppointment(current) ? 'cancelled' : null
    case 'complete':
      return current === 'confirmed' ? 'completed' : null
    default:
      return null
  }
}

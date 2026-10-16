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

// ─── Filtres de recherche (vue globale du tableau de bord, GF-DUR-054) ────────

/** Entrée brute des filtres, telle qu'elle sort de la requête HTTP. */
export interface FiltresRendezVousBruts {
  statuts?: readonly string[]
  /** Jour exact `YYYY-MM-DD`. Prioritaire sur la période. */
  date?:    string
  from?:    string
  to?:      string
  clientId?: string
  vehicleId?: string
  /** Fragment d'immatriculation (contient, insensible à la casse côté SQLite non). */
  plate?:   string
  /** Recherche plein texte : client, véhicule, immatriculation ou motif. */
  q?:       string
}

/**
 * Filtre Prisma d'un rendez-vous, réduit aux champs que cette fonction produit.
 *
 * `date` accepte une VALEUR (`'2026-10-16'`) ou un INTERVALLE (`{ gte, lte }`).
 * C'est cette union qui manquait : construire `{ date: { date: … } }` produit un
 * filtre que Prisma refuse à l'exécution (« Unknown argument `date` »), et aucun
 * test ne le voyait — le client Prisma n'étant pas généré hors CI, tous les
 * appels y sont typés `any`. Le contrat est donc écrit ici, en clair, et vérifié
 * par des tests unitaires.
 */
export interface FiltreRendezVous {
  status?:       string | { in: string[] }
  date?:         string | { gte?: string; lte?: string }
  clientId?:     string
  vehicleId?:    string
  licensePlate?: { contains: string }
  OR?: Array<{
    clientName?:   { contains: string }
    licensePlate?: { contains: string }
    vehicleModel?: { contains: string }
    reason?:       { contains: string }
  }>
}

/** Construit le filtre Prisma correspondant aux filtres demandés (sans le garage). */
export function construireFiltreRendezVous(f: FiltresRendezVousBruts): FiltreRendezVous {
  const filtre: FiltreRendezVous = {}

  const statuts = (f.statuts ?? []).map((s) => s.trim()).filter(Boolean)
  if (statuts.length === 1) filtre.status = statuts[0]
  else if (statuts.length > 1) filtre.status = { in: statuts }

  // Un jour exact l'emporte sur la période : c'est la demande la plus précise.
  if (f.date) filtre.date = f.date
  else if (f.from || f.to) {
    filtre.date = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    }
  }

  if (f.clientId) filtre.clientId = f.clientId
  if (f.vehicleId) filtre.vehicleId = f.vehicleId
  if (f.plate) filtre.licensePlate = { contains: f.plate }

  if (f.q) {
    filtre.OR = [
      { clientName:   { contains: f.q } },
      { licensePlate: { contains: f.q } },
      { vehicleModel: { contains: f.q } },
      { reason:       { contains: f.q } },
    ]
  }

  return filtre
}

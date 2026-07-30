/**
 * Analytics input DTOs.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Minimal, typed projections of the real Prisma models needed by the analytics
 * engine (metrics, health score, copilote insights). Keeping the engine pure —
 * operating on these plain shapes rather than the Prisma client — makes every
 * computation deterministic and unit-testable, and guarantees the analysis is
 * derived exclusively from real persisted data (no fabricated values).
 *
 * The data collector (analytics/collect.ts) is the only place that maps Prisma
 * rows onto these DTOs.
 */

/** A single billing line (invoice or quote), the unit of revenue/cost. */
export interface AnalyticsLine {
  quantity: number
  unitPrice: number
  unitCost: number
  isLabor: boolean
}

/** Job / intervention projection. `date` is the business day 'YYYY-MM-DD'. */
export interface JobInput {
  id: string
  status: string
  estimatedDuration: number
  actualDuration: number | null
  date: string
  createdAt: Date
  updatedAt: Date
  mechanicId: string
  isUrgent: boolean
  customerName: string
  vehicleModel: string | null
  licensePlate: string | null
}

/** Invoice projection. `issueDate`/`dueDate` are 'YYYY-MM-DD' strings. */
export interface InvoiceInput {
  id: string
  number: string
  status: string
  issueDate: string
  dueDate: string | null
  createdAt: Date
  taxRate: number
  lines: AnalyticsLine[]
  clientId: string | null
  clientName: string
}

/** Quote / devis projection. */
export interface QuoteInput {
  id: string
  number: string
  status: string
  issueDate: string
  validUntil: string | null
  createdAt: Date
  taxRate: number
  lines: AnalyticsLine[]
  clientId: string | null
  clientName: string
}

/** Stock part projection. */
export interface PartInput {
  id: string
  name: string
  reference: string | null
  quantity: number
  minQuantity: number
  unitCost: number
  unitPrice: number
}

/** Warranty projection. */
export interface WarrantyInput {
  id: string
  status: string
  expiresAt: Date
  clientName: string
  vehicleModel: string | null
  licensePlate: string | null
  partName: string
}

/** Client projection. */
export interface ClientInput {
  id: string
  name: string
  createdAt: Date
}

/** Mechanic projection. */
export interface MechanicInput {
  id: string
  name: string
  isAbsent: boolean
}

/** The full real-data bundle for one garage over an analysis window. */
export interface GarageDataset {
  /** Analysis window length in days. */
  periodDays: number
  /** Inclusive window start / end (Date, at day resolution). */
  windowStart: Date
  windowEnd: Date
  /** Garage tuning used for capacity/labour computations. */
  hourlyRate: number
  workshopStartHour: number
  workshopEndHour: number
  jobs: JobInput[]
  invoices: InvoiceInput[]
  quotes: QuoteInput[]
  parts: PartInput[]
  warranties: WarrantyInput[]
  clients: ClientInput[]
  mechanics: MechanicInput[]
  /** Evaluation instant (injectable for deterministic tests). */
  now: Date
}

/** Terminal job statuses — the vehicle has left the workshop. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'done',
  'delivered',
  'cancelled',
])

/** Statuses that count as confirmed cash. */
export const PAID_INVOICE_STATUS = 'paid'

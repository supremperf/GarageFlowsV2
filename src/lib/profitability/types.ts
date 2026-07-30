/**
 * Profitability analytics — shared types.
 *
 * The engine is pure: it operates on plain, normalized records (mapped from
 * Prisma by the API layer), so all computations are deterministic and testable.
 * Money is expected in the garage currency; all outputs are rounded to cents.
 */

export interface AnalyzedLine {
  description: string
  quantity: number
  unitPrice: number
  unitCost: number
  isLabor?: boolean
}

export interface AnalyzedInvoice {
  id: string
  number: string
  status: string
  clientId?: string | null
  clientName?: string | null
  vehicleId?: string | null
  make?: string | null
  mechanicId?: string | null
  mechanicName?: string | null
  lines: AnalyzedLine[]
}

/** A job part sale (from JobPart) — the reliable link between sales and stock. */
export interface AnalyzedJobPart {
  partId: string
  partName: string
  quantity: number
  unitPrice: number
  unitCost: number
}

export interface PartStock {
  id: string
  name: string
  reference?: string | null
  quantity: number
  unitCost: number
  unitPrice: number
}

export interface Margin {
  revenueHT: number
  costHT: number
  margin: number
  marginPct: number | null // null when revenue is 0
}

export interface DimensionMargin extends Margin {
  key: string
  label: string
  count: number
}

export interface PartMargin extends Margin {
  partId: string
  partName: string
  qtySold: number
}

export type AnomalyType =
  | 'dormant_stock'
  | 'low_margin_invoice'
  | 'negative_margin_invoice'
  | 'deficit_client'
  | 'negative_margin_part'

export interface Anomaly {
  type: AnomalyType
  severity: 'high' | 'medium' | 'low'
  label: string
  detail: string
  /** Money at stake (tied-up stock value, lost margin, …). */
  amount: number
  ref?: { id?: string; name?: string }
}

export interface Thresholds {
  /** Invoice margin % below which it is "low margin". Default 0.10 (10%). */
  lowMarginPct: number
}

export interface AnalyzeInput {
  invoices: AnalyzedInvoice[]
  jobParts?: AnalyzedJobPart[]
  parts?: PartStock[]
  thresholds?: Partial<Thresholds>
  currency?: string
}

export interface ProfitabilityReport {
  currency: string
  totals: Margin & { invoiceCount: number }
  byClient: DimensionMargin[]
  byVehicle: DimensionMargin[]
  byMake: DimensionMargin[]
  byMechanic: DimensionMargin[]
  byPart: PartMargin[]
  invoices: Array<{ id: string; number: string } & Margin>
  anomalies: Anomaly[]
  recommendations: string[]
}

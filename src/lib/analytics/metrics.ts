/**
 * Analytics metrics engine — pure, deterministic computations over a real
 * {@link GarageDataset}. Every value returned here is derived from persisted
 * data; nothing is estimated or invented. The health score and copilote insights
 * are built exclusively on top of these metrics.
 */

import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { fromCents, lineCents } from '@/lib/money'
import {
  type GarageDataset,
  type AnalyticsLine,
  TERMINAL_JOB_STATUSES,
} from './types'

/** Tunable thresholds; defaults are sensible for a typical garage. */
export interface MetricThresholds {
  /** A non-terminal job older than this (days) counts as an immobilised vehicle. */
  immobilizedDays: number
  /** A warranty expiring within this many days is "expiring soon". */
  warrantyExpiryDays: number
  /** A client with no activity for this many days is "inactive". */
  inactiveClientDays: number
  /** A 'sent' quote older than this many days (and not resolved) is "un-followed". */
  quoteStaleDays: number
}

export const DEFAULT_THRESHOLDS: MetricThresholds = {
  immobilizedDays: 3,
  warrantyExpiryDays: 30,
  inactiveClientDays: 180,
  quoteStaleDays: 7,
}

// ─── Result shapes ───────────────────────────────────────────────────────────

export interface RevenueMetrics {
  paidHT: number
  paidTTC: number
  paidCost: number
  marginHT: number
  /** null when there is no revenue to compute a rate from. */
  marginRatePct: number | null
  invoiceCount: number
}

export interface RepairTimeMetrics {
  completedCount: number
  avgActualMin: number | null
  avgEstimatedMin: number | null
  /** estimated / actual × 100; >100 = faster than estimated. null if no data. */
  efficiencyPct: number | null
}

export interface ImmobilizedVehicle {
  jobId: string
  licensePlate: string | null
  vehicleModel: string | null
  customerName: string
  status: string
  days: number
}

export interface OverdueInvoice {
  id: string
  number: string
  clientName: string
  amountTTC: number
  dueDate: string | null
  daysOverdue: number
}

export interface StaleQuote {
  id: string
  number: string
  clientName: string
  amountTTC: number
  issueDate: string
  daysOpen: number
  expired: boolean
}

export interface StockItem {
  id: string
  name: string
  reference: string | null
  quantity: number
  minQuantity: number
  /** How many units below the minimum threshold. */
  shortBy: number
  critical: boolean
}

export interface ExpiringWarranty {
  id: string
  clientName: string
  partName: string
  licensePlate: string | null
  expiresAt: Date
  daysLeft: number
  expired: boolean
}

export interface MechanicLoad {
  mechanicId: string
  name: string
  jobCount: number
  assignedMin: number
  capacityMin: number
  /** assignedMin / capacityMin × 100. */
  loadPct: number
}

export interface InactiveClient {
  id: string
  name: string
  lastActivity: Date | null
  daysInactive: number | null
}

export interface CostlyVehicle {
  licensePlate: string
  vehicleModel: string | null
  totalMin: number
  jobCount: number
}

/** Which metric families had enough data to be meaningful. */
export interface DataSufficiency {
  revenue: boolean
  repairTime: boolean
  quotes: boolean
  stock: boolean
  mechanics: boolean
}

/** Absolute counts used for ratio-based scoring (robust to garage size). */
export interface MetricTotals {
  jobCount: number
  openJobCount: number
  partCount: number
  clientCount: number
  resolvedQuoteCount: number
}

export interface GarageMetrics {
  periodDays: number
  totals: MetricTotals
  revenue: RevenueMetrics
  repairTime: RepairTimeMetrics
  immobilizedVehicles: ImmobilizedVehicle[]
  overdueInvoices: OverdueInvoice[]
  /** Total sent-but-unpaid amount (TTC), overdue or not. */
  outstandingTTC: number
  staleQuotes: StaleQuote[]
  quoteConversionPct: number | null
  lowStock: StockItem[]
  criticalStock: StockItem[]
  expiringWarranties: ExpiringWarranty[]
  activeWarrantyClaimRatePct: number | null
  mechanicLoads: MechanicLoad[]
  inactiveClients: InactiveClient[]
  cancelledJobCount: number
  topCostlyVehicles: CostlyVehicle[]
  utilizationPct: number | null
  dataSufficiency: DataSufficiency
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Coût total des lignes via la couche centimes (arrondi PAR LIGNE, cohérent avec
// calcTotalHT/le FEC), au lieu d'une accumulation flottante native.
const lineCost = (lines: AnalyticsLine[]): number =>
  fromCents(lines.reduce((c, l) => c + lineCents(l.unitCost, l.quantity), 0))

/** Parse a 'YYYY-MM-DD' string to a Date, or null when absent/invalid. */
function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = parseISO(s)
  return isValid(d) ? d : null
}

// ─── Metric computations ─────────────────────────────────────────────────────

/** Confirmed revenue, cost and margin from PAID invoices in the window. */
export function computeRevenue(dataset: GarageDataset): RevenueMetrics {
  const paid = dataset.invoices.filter(i => i.status === 'paid')
  const paidHT = paid.reduce((s, i) => s + calcTotalHT(i.lines), 0)
  const paidTTC = paid.reduce((s, i) => s + calcTotalTTC(i.lines, i.taxRate), 0)
  const paidCost = paid.reduce((s, i) => s + lineCost(i.lines), 0)
  const marginHT = paidHT - paidCost
  return {
    paidHT: roundCents(paidHT),
    paidTTC: roundCents(paidTTC),
    paidCost: roundCents(paidCost),
    marginHT: roundCents(marginHT),
    marginRatePct: paidHT > 0 ? Math.round((marginHT / paidHT) * 100) : null,
    invoiceCount: paid.length,
  }
}

/** Average real vs estimated repair time and resulting efficiency. */
export function computeRepairTime(dataset: GarageDataset): RepairTimeMetrics {
  const completed = dataset.jobs.filter(
    j => (j.status === 'completed' || j.status === 'done') && j.actualDuration != null && j.actualDuration > 0,
  )
  if (completed.length === 0) {
    return { completedCount: 0, avgActualMin: null, avgEstimatedMin: null, efficiencyPct: null }
  }
  const totalActual = completed.reduce((s, j) => s + (j.actualDuration ?? 0), 0)
  const totalEst = completed.reduce((s, j) => s + j.estimatedDuration, 0)
  return {
    completedCount: completed.length,
    avgActualMin: Math.round(totalActual / completed.length),
    avgEstimatedMin: Math.round(totalEst / completed.length),
    efficiencyPct: totalActual > 0 ? Math.round((totalEst / totalActual) * 100) : null,
  }
}

/** Non-terminal jobs that have been open longer than the threshold. */
export function computeImmobilizedVehicles(
  dataset: GarageDataset,
  thresholds: MetricThresholds,
): ImmobilizedVehicle[] {
  const result: ImmobilizedVehicle[] = []
  for (const j of dataset.jobs) {
    if (TERMINAL_JOB_STATUSES.has(j.status)) continue
    const day = parseDay(j.date)
    if (!day) continue
    const days = differenceInCalendarDays(dataset.now, day)
    if (days >= thresholds.immobilizedDays) {
      result.push({
        jobId: j.id,
        licensePlate: j.licensePlate,
        vehicleModel: j.vehicleModel,
        customerName: j.customerName,
        status: j.status,
        days,
      })
    }
  }
  return result.sort((a, b) => b.days - a.days)
}

/** Sent-but-unpaid invoices; overdue ones (past dueDate) are surfaced. */
export function computeOverdueInvoices(dataset: GarageDataset): {
  overdue: OverdueInvoice[]
  outstandingTTC: number
} {
  const unpaid = dataset.invoices.filter(i => i.status === 'sent' || i.status === 'overdue')
  const outstandingTTC = unpaid.reduce((s, i) => s + calcTotalTTC(i.lines, i.taxRate), 0)
  const overdue: OverdueInvoice[] = []
  for (const i of unpaid) {
    const due = parseDay(i.dueDate)
    const daysOverdue = due ? differenceInCalendarDays(dataset.now, due) : 0
    if (daysOverdue > 0) {
      overdue.push({
        id: i.id,
        number: i.number,
        clientName: i.clientName,
        amountTTC: roundCents(calcTotalTTC(i.lines, i.taxRate)),
        dueDate: i.dueDate,
        daysOverdue,
      })
    }
  }
  return {
    overdue: overdue.sort((a, b) => b.daysOverdue - a.daysOverdue),
    outstandingTTC: roundCents(outstandingTTC),
  }
}

/** 'sent' quotes that are expired or stale (never followed up). */
export function computeStaleQuotes(dataset: GarageDataset, thresholds: MetricThresholds): StaleQuote[] {
  const result: StaleQuote[] = []
  for (const q of dataset.quotes) {
    if (q.status !== 'sent') continue
    const issue = parseDay(q.issueDate) ?? q.createdAt
    const daysOpen = differenceInCalendarDays(dataset.now, issue)
    const validUntil = parseDay(q.validUntil)
    const expired = validUntil ? differenceInCalendarDays(dataset.now, validUntil) > 0 : false
    if (expired || daysOpen >= thresholds.quoteStaleDays) {
      result.push({
        id: q.id,
        number: q.number,
        clientName: q.clientName,
        amountTTC: roundCents(calcTotalTTC(q.lines, q.taxRate)),
        issueDate: q.issueDate,
        daysOpen,
        expired,
      })
    }
  }
  return result.sort((a, b) => b.daysOpen - a.daysOpen)
}

/** Quote conversion rate = accepted / (accepted + refused + converted). */
export function computeQuoteConversion(dataset: GarageDataset): number | null {
  const resolved = dataset.quotes.filter(q =>
    q.status === 'accepted' || q.status === 'refused' || q.status === 'converted',
  )
  if (resolved.length === 0) return null
  const won = resolved.filter(q => q.status === 'accepted' || q.status === 'converted').length
  return Math.round((won / resolved.length) * 100)
}

/** Low-stock and critical (zero) parts. */
export function computeStock(dataset: GarageDataset): { lowStock: StockItem[]; criticalStock: StockItem[] } {
  const lowStock: StockItem[] = []
  const criticalStock: StockItem[] = []
  for (const p of dataset.parts) {
    if (p.quantity > p.minQuantity) continue
    const item: StockItem = {
      id: p.id,
      name: p.name,
      reference: p.reference,
      quantity: p.quantity,
      minQuantity: p.minQuantity,
      shortBy: Math.max(0, p.minQuantity - p.quantity),
      critical: p.quantity <= 0,
    }
    if (item.critical) criticalStock.push(item)
    else lowStock.push(item)
  }
  const bySeverity = (a: StockItem, b: StockItem): number => b.shortBy - a.shortBy
  return { lowStock: lowStock.sort(bySeverity), criticalStock: criticalStock.sort(bySeverity) }
}

/** Active warranties expiring within the threshold (or just expired but still active). */
export function computeExpiringWarranties(
  dataset: GarageDataset,
  thresholds: MetricThresholds,
): ExpiringWarranty[] {
  const result: ExpiringWarranty[] = []
  for (const w of dataset.warranties) {
    if (w.status !== 'active') continue
    const daysLeft = differenceInCalendarDays(w.expiresAt, dataset.now)
    if (daysLeft <= thresholds.warrantyExpiryDays) {
      result.push({
        id: w.id,
        clientName: w.clientName,
        partName: w.partName,
        licensePlate: w.licensePlate,
        expiresAt: w.expiresAt,
        daysLeft,
        expired: daysLeft < 0,
      })
    }
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft)
}

/** Ratio of warranties that ended in a claim (a proxy for after-sales quality). */
export function computeWarrantyClaimRate(dataset: GarageDataset): number | null {
  const relevant = dataset.warranties.filter(w => w.status === 'active' || w.status === 'claimed')
  if (relevant.length === 0) return null
  const claimed = relevant.filter(w => w.status === 'claimed').length
  return Math.round((claimed / relevant.length) * 100)
}

/** Per-mechanic assigned workload (non-terminal jobs) vs workshop capacity. */
export function computeMechanicLoads(dataset: GarageDataset): MechanicLoad[] {
  const hoursPerDay = Math.max(1, dataset.workshopEndHour - dataset.workshopStartHour)
  const capacityMin = hoursPerDay * 60 * dataset.periodDays
  return dataset.mechanics.map(m => {
    const jobs = dataset.jobs.filter(j => j.mechanicId === m.id && !TERMINAL_JOB_STATUSES.has(j.status))
    const assignedMin = jobs.reduce((s, j) => s + (j.actualDuration ?? j.estimatedDuration), 0)
    const capacity = m.isAbsent ? 0 : capacityMin
    return {
      mechanicId: m.id,
      name: m.name,
      jobCount: jobs.length,
      assignedMin,
      capacityMin: capacity,
      loadPct: capacity > 0 ? Math.round((assignedMin / capacity) * 100) : 0,
    }
  })
}

/** Clients whose most recent quote/invoice is older than the inactivity threshold. */
export function computeInactiveClients(
  dataset: GarageDataset,
  thresholds: MetricThresholds,
): InactiveClient[] {
  const lastActivity = new Map<string, Date>()
  const record = (clientId: string | null, when: Date): void => {
    if (!clientId) return
    const prev = lastActivity.get(clientId)
    if (!prev || when > prev) lastActivity.set(clientId, when)
  }
  for (const i of dataset.invoices) record(i.clientId, i.createdAt)
  for (const q of dataset.quotes) record(q.clientId, q.createdAt)

  const result: InactiveClient[] = []
  for (const c of dataset.clients) {
    const last = lastActivity.get(c.id) ?? null
    const reference = last ?? c.createdAt
    const daysInactive = differenceInCalendarDays(dataset.now, reference)
    if (daysInactive >= thresholds.inactiveClientDays) {
      result.push({ id: c.id, name: c.name, lastActivity: last, daysInactive })
    }
  }
  return result.sort((a, b) => (b.daysInactive ?? 0) - (a.daysInactive ?? 0))
}

/** Vehicles ranked by total workshop time consumed (top 5). */
export function computeTopCostlyVehicles(dataset: GarageDataset, limit = 5): CostlyVehicle[] {
  const byPlate = new Map<string, CostlyVehicle>()
  for (const j of dataset.jobs) {
    const plate = j.licensePlate?.trim()
    if (!plate) continue
    const minutes = j.actualDuration ?? j.estimatedDuration
    const entry = byPlate.get(plate) ?? {
      licensePlate: plate,
      vehicleModel: j.vehicleModel,
      totalMin: 0,
      jobCount: 0,
    }
    entry.totalMin += minutes
    entry.jobCount += 1
    byPlate.set(plate, entry)
  }
  return Array.from(byPlate.values())
    .sort((a, b) => b.totalMin - a.totalMin)
    .slice(0, limit)
}

/** True when a job's business day falls inside the analysis window. */
function inWindow(dataset: GarageDataset, dateStr: string): boolean {
  const d = parseDay(dateStr)
  if (!d) return false
  return differenceInCalendarDays(d, dataset.windowStart) >= 0 &&
    differenceInCalendarDays(dataset.windowEnd, d) >= 0
}

/**
 * Workshop utilisation = scheduled minutes / available capacity over the window.
 * Only jobs dated inside the window count — the dataset may also carry older
 * still-open jobs (for immobilisation detection) which must not inflate this.
 */
export function computeUtilization(dataset: GarageDataset): number | null {
  const activeMechanics = dataset.mechanics.filter(m => !m.isAbsent).length
  if (activeMechanics === 0) return null
  const hoursPerDay = Math.max(1, dataset.workshopEndHour - dataset.workshopStartHour)
  const capacityMin = hoursPerDay * 60 * dataset.periodDays * activeMechanics
  if (capacityMin <= 0) return null
  const scheduledMin = dataset.jobs
    .filter(j => j.status !== 'cancelled' && inWindow(dataset, j.date))
    .reduce((s, j) => s + (j.actualDuration ?? j.estimatedDuration), 0)
  return Math.min(100, Math.round((scheduledMin / capacityMin) * 100))
}

/** Compute the full metric bundle for one garage window. */
export function computeMetrics(
  dataset: GarageDataset,
  thresholds: MetricThresholds = DEFAULT_THRESHOLDS,
): GarageMetrics {
  const revenue = computeRevenue(dataset)
  const repairTime = computeRepairTime(dataset)
  const { overdue, outstandingTTC } = computeOverdueInvoices(dataset)
  const { lowStock, criticalStock } = computeStock(dataset)

  const openJobCount = dataset.jobs.filter(j => !TERMINAL_JOB_STATUSES.has(j.status)).length
  const resolvedQuoteCount = dataset.quotes.filter(
    q => q.status === 'accepted' || q.status === 'refused' || q.status === 'converted',
  ).length

  return {
    periodDays: dataset.periodDays,
    totals: {
      jobCount: dataset.jobs.length,
      openJobCount,
      partCount: dataset.parts.length,
      clientCount: dataset.clients.length,
      resolvedQuoteCount,
    },
    revenue,
    repairTime,
    immobilizedVehicles: computeImmobilizedVehicles(dataset, thresholds),
    overdueInvoices: overdue,
    outstandingTTC,
    staleQuotes: computeStaleQuotes(dataset, thresholds),
    quoteConversionPct: computeQuoteConversion(dataset),
    lowStock,
    criticalStock,
    expiringWarranties: computeExpiringWarranties(dataset, thresholds),
    activeWarrantyClaimRatePct: computeWarrantyClaimRate(dataset),
    mechanicLoads: computeMechanicLoads(dataset),
    inactiveClients: computeInactiveClients(dataset, thresholds),
    cancelledJobCount: dataset.jobs.filter(j => j.status === 'cancelled').length,
    topCostlyVehicles: computeTopCostlyVehicles(dataset),
    utilizationPct: computeUtilization(dataset),
    dataSufficiency: {
      revenue: revenue.invoiceCount > 0,
      repairTime: repairTime.completedCount >= 2,
      quotes: dataset.quotes.length > 0,
      stock: dataset.parts.length > 0,
      mechanics: dataset.mechanics.length > 0,
    },
  }
}

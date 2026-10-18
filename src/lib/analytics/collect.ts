/**
 * Analytics data collector — the ONLY bridge between Prisma and the pure
 * analytics engine. Everything below reads real, garage-scoped rows and maps
 * them onto the {@link GarageDataset} DTOs. No data is synthesised.
 *
 * Point-in-time families (stock, warranties, clients, mechanics) reflect current
 * state. Transactional families (jobs, invoices, quotes) are window-scoped, with
 * two deliberate exceptions so open items are never missed:
 *   • jobs — also includes every non-terminal job regardless of age
 *            (immobilised-vehicle detection);
 *   • invoices — also includes every unpaid invoice regardless of age
 *            (outstanding / overdue detection).
 */

import { subDays, startOfDay, endOfDay, format } from 'date-fns'
import { prisma } from '@/lib/db'
import { fromScaled } from '@/lib/money'
import { partToEuros } from '@/lib/money-db'
import {
  type GarageDataset,
  type JobInput,
  type InvoiceInput,
  type QuoteInput,
  type AnalyticsLine,
  TERMINAL_JOB_STATUSES,
} from './types'

const TERMINAL = Array.from(TERMINAL_JOB_STATUSES)

// Lignes stockées en ENTIERS exacts (dix-millièmes) ; l'analytics consomme la vue euros dérivée.
type LineRow = { quantityTenThousandths: number; unitPriceTenThousandths: number; unitCostTenThousandths: number; isLabor: boolean }
const mapLines = (lines: LineRow[]): AnalyticsLine[] =>
  lines.map(l => ({ quantity: fromScaled(l.quantityTenThousandths), unitPrice: fromScaled(l.unitPriceTenThousandths), unitCost: fromScaled(l.unitCostTenThousandths), isLabor: l.isLabor }))

const JOB_SELECT = {
  id: true, status: true, estimatedDuration: true, actualDuration: true,
  date: true, createdAt: true, updatedAt: true, mechanicId: true,
  isUrgent: true, customerName: true, vehicleModel: true, licensePlate: true,
} as const

const mapJob = (j: {
  id: string; status: string; estimatedDuration: number; actualDuration: number | null
  date: string; createdAt: Date; updatedAt: Date; mechanicId: string; isUrgent: boolean
  customerName: string; vehicleModel: string | null; licensePlate: string | null
}): JobInput => ({ ...j })

const mapInvoice = (i: {
  id: string; number: string; status: string; issueDate: string; dueDate: string | null
  createdAt: Date; taxRate: number; clientId: string | null; clientName: string
  lines: LineRow[]
}): InvoiceInput => ({ ...i, lines: mapLines(i.lines) })

const mapQuote = (q: {
  id: string; number: string; status: string; issueDate: string; validUntil: string | null
  createdAt: Date; taxRate: number; clientId: string | null; clientName: string
  lines: LineRow[]
}): QuoteInput => ({ ...q, lines: mapLines(q.lines) })

/** Sanitise the requested period to a safe range (days). */
export function normalizePeriod(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 30
  return Math.min(365, Math.max(1, Math.round(n)))
}

/**
 * Collect the current and previous windows for one garage.
 * Point-in-time reference data (stock, warranties, clients, mechanics) is fetched
 * once and shared, so the health trend reflects transactional change, not
 * un-reconstructable historical stock state.
 */
export async function collectGarageWindows(
  garageId: string,
  periodDays: number,
  now: Date = new Date(),
): Promise<{ current: GarageDataset; previous: GarageDataset }> {
  const curEnd = now
  const curStart = subDays(now, periodDays - 1)
  const prevEnd = subDays(curStart, 1)
  const prevStart = subDays(prevEnd, periodDays - 1)

  const curStartStr = format(curStart, 'yyyy-MM-dd')
  const curEndStr = format(curEnd, 'yyyy-MM-dd')
  const prevStartStr = format(prevStart, 'yyyy-MM-dd')
  const prevEndStr = format(prevEnd, 'yyyy-MM-dd')

  const [
    garage, mechanics, parts, warranties, clients,
    curJobs, curInvoices, curQuotes,
    prevJobs, prevInvoices, prevQuotes,
  ] = await Promise.all([
    prisma.garage.findUnique({
      where: { id: garageId },
      select: { hourlyRateTenThousandths: true, workshopStartHour: true, workshopEndHour: true },
    }),
    prisma.mechanic.findMany({ where: { garageId }, select: { id: true, name: true, isAbsent: true } }),
    prisma.part.findMany({
      where: { garageId },
      select: { id: true, name: true, reference: true, quantity: true, minQuantity: true, unitCostTenThousandths: true, unitPriceTenThousandths: true },
    }),
    prisma.warranty.findMany({
      where: { garageId, status: { in: ['active', 'claimed'] } },
      select: { id: true, status: true, expiresAt: true, clientName: true, vehicleModel: true, licensePlate: true, partName: true },
    }),
    prisma.client.findMany({ where: { garageId }, select: { id: true, name: true, createdAt: true } }),

    // Current window: jobs dated in-window OR any still-open job.
    prisma.job.findMany({
      where: { garageId, OR: [{ date: { gte: curStartStr, lte: curEndStr } }, { status: { notIn: TERMINAL } }] },
      select: JOB_SELECT,
    }),
    // Current window: paid invoices in-window OR any unpaid invoice.
    prisma.invoice.findMany({
      where: { garageId, OR: [{ status: 'paid', createdAt: { gte: startOfDay(curStart), lte: endOfDay(curEnd) } }, { status: { in: ['sent', 'overdue'] } }] },
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, createdAt: true, taxRate: true, clientId: true, clientName: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, isLabor: true } } },
    }),
    // Current window: quotes created in-window OR any still-sent quote.
    prisma.quote.findMany({
      where: { garageId, OR: [{ createdAt: { gte: startOfDay(curStart), lte: endOfDay(curEnd) } }, { status: 'sent' }] },
      select: { id: true, number: true, status: true, issueDate: true, validUntil: true, createdAt: true, taxRate: true, clientId: true, clientName: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, isLabor: true } } },
    }),

    // Previous window: transactional data only (for the trend).
    prisma.job.findMany({ where: { garageId, date: { gte: prevStartStr, lte: prevEndStr } }, select: JOB_SELECT }),
    prisma.invoice.findMany({
      where: { garageId, createdAt: { gte: startOfDay(prevStart), lte: endOfDay(prevEnd) } },
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, createdAt: true, taxRate: true, clientId: true, clientName: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, isLabor: true } } },
    }),
    prisma.quote.findMany({
      where: { garageId, createdAt: { gte: startOfDay(prevStart), lte: endOfDay(prevEnd) } },
      select: { id: true, number: true, status: true, issueDate: true, validUntil: true, createdAt: true, taxRate: true, clientId: true, clientName: true, lines: { select: { quantityTenThousandths: true, unitPriceTenThousandths: true, unitCostTenThousandths: true, isLabor: true } } },
    }),
  ])

  const mechanicsInput = mechanics.map(m => ({ ...m }))
  const partsInput = parts.map(p => partToEuros(p))
  const warrantiesInput = warranties.map(w => ({ ...w }))
  const clientsInput = clients.map(c => ({ ...c }))

  const shared = {
    periodDays,
    // Sans garage lisible, le tarif est INCONNU — surtout pas 60 €/h, qui
    // ferait apparaître une valorisation d'heures et des marges calculées sur un
    // tarif que personne n'a choisi. Zéro se voit ; un faux tarif se croit.
    hourlyRate: garage ? fromScaled(garage.hourlyRateTenThousandths) : 0,
    workshopStartHour: garage?.workshopStartHour ?? 8,
    workshopEndHour: garage?.workshopEndHour ?? 18,
    parts: partsInput,
    warranties: warrantiesInput,
    clients: clientsInput,
    mechanics: mechanicsInput,
  }

  const current: GarageDataset = {
    ...shared,
    windowStart: curStart,
    windowEnd: curEnd,
    now,
    jobs: curJobs.map(mapJob),
    invoices: curInvoices.map(mapInvoice),
    quotes: curQuotes.map(mapQuote),
  }

  const previous: GarageDataset = {
    ...shared,
    windowStart: prevStart,
    windowEnd: prevEnd,
    now: prevEnd,
    jobs: prevJobs.map(mapJob),
    invoices: prevInvoices.map(mapInvoice),
    quotes: prevQuotes.map(mapQuote),
  }

  return { current, previous }
}

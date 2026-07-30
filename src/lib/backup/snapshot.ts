/**
 * Garage data snapshot & restore table map (Phase 1 backups).
 *
 * A single ordered list of table specs drives both the snapshot (parent→child
 * reads) and the restore (child→parent deletes, then parent→child inserts),
 * keeping the two in lock-step. Child tables without a direct `garageId` are
 * scoped through their parent relation. All work runs inside a transaction, so a
 * restore is atomic. Prisma coerces ISO date strings back to DateTime, so the
 * round-trip needs no manual date revival.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient
type Row = Record<string, unknown>

interface TableSpec {
  key: string
  read: (tx: Tx, garageId: string) => Promise<Row[]>
  del: (tx: Tx, garageId: string) => Promise<unknown>
  create: (tx: Tx, rows: Row[]) => Promise<unknown>
}

/**
 * Ordered parent→child. Snapshot reads in this order; restore deletes in the
 * reverse order and re-creates in this order.
 */
export const TABLE_SPECS: TableSpec[] = [
  {
    key: 'clients',
    read: (tx, g) => tx.client.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.client.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.client.createMany({ data: rows as Prisma.ClientCreateManyInput[] }),
  },
  {
    key: 'mechanics',
    read: (tx, g) => tx.mechanic.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.mechanic.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.mechanic.createMany({ data: rows as Prisma.MechanicCreateManyInput[] }),
  },
  {
    key: 'parts',
    read: (tx, g) => tx.part.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.part.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.part.createMany({ data: rows as Prisma.PartCreateManyInput[] }),
  },
  {
    key: 'laborOperations',
    read: (tx, g) => tx.laborOperation.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.laborOperation.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.laborOperation.createMany({ data: rows as Prisma.LaborOperationCreateManyInput[] }),
  },
  {
    key: 'vehicles',
    read: (tx, g) => tx.vehicle.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.vehicle.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.vehicle.createMany({ data: rows as Prisma.VehicleCreateManyInput[] }),
  },
  {
    key: 'jobs',
    read: (tx, g) => tx.job.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.job.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.job.createMany({ data: rows as Prisma.JobCreateManyInput[] }),
  },
  {
    key: 'jobParts',
    read: (tx, g) => tx.jobPart.findMany({ where: { job: { garageId: g } } }),
    del: (tx, g) => tx.jobPart.deleteMany({ where: { job: { garageId: g } } }),
    create: (tx, rows) => tx.jobPart.createMany({ data: rows as Prisma.JobPartCreateManyInput[] }),
  },
  {
    key: 'quotes',
    read: (tx, g) => tx.quote.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.quote.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.quote.createMany({ data: rows as Prisma.QuoteCreateManyInput[] }),
  },
  {
    key: 'quoteLines',
    read: (tx, g) => tx.quoteLine.findMany({ where: { quote: { garageId: g } } }),
    del: (tx, g) => tx.quoteLine.deleteMany({ where: { quote: { garageId: g } } }),
    create: (tx, rows) => tx.quoteLine.createMany({ data: rows as Prisma.QuoteLineCreateManyInput[] }),
  },
  {
    key: 'invoices',
    read: (tx, g) => tx.invoice.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.invoice.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.invoice.createMany({ data: rows as Prisma.InvoiceCreateManyInput[] }),
  },
  {
    key: 'invoiceLines',
    read: (tx, g) => tx.invoiceLine.findMany({ where: { invoice: { garageId: g } } }),
    del: (tx, g) => tx.invoiceLine.deleteMany({ where: { invoice: { garageId: g } } }),
    create: (tx, rows) => tx.invoiceLine.createMany({ data: rows as Prisma.InvoiceLineCreateManyInput[] }),
  },
  {
    key: 'reminders',
    read: (tx, g) => tx.reminder.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.reminder.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.reminder.createMany({ data: rows as Prisma.ReminderCreateManyInput[] }),
  },
  {
    key: 'inspections',
    read: (tx, g) => tx.inspection.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.inspection.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.inspection.createMany({ data: rows as Prisma.InspectionCreateManyInput[] }),
  },
  {
    key: 'inspectionItems',
    read: (tx, g) => tx.inspectionItem.findMany({ where: { inspection: { garageId: g } } }),
    del: (tx, g) => tx.inspectionItem.deleteMany({ where: { inspection: { garageId: g } } }),
    create: (tx, rows) => tx.inspectionItem.createMany({ data: rows as Prisma.InspectionItemCreateManyInput[] }),
  },
  {
    key: 'workOrders',
    read: (tx, g) => tx.workOrder.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.workOrder.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.workOrder.createMany({ data: rows as Prisma.WorkOrderCreateManyInput[] }),
  },
  {
    key: 'warranties',
    read: (tx, g) => tx.warranty.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.warranty.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.warranty.createMany({ data: rows as Prisma.WarrantyCreateManyInput[] }),
  },
  {
    key: 'signatures',
    read: (tx, g) => tx.signature.findMany({ where: { garageId: g } }),
    del: (tx, g) => tx.signature.deleteMany({ where: { garageId: g } }),
    create: (tx, rows) => tx.signature.createMany({ data: rows as Prisma.SignatureCreateManyInput[] }),
  },
]

export interface GarageSnapshot {
  version: 1
  garageId: string
  createdAt: string
  tables: Record<string, Row[]>
}

/** Read a consistent, garage-scoped snapshot of all backed-up tables. */
export async function snapshotGarage(tx: Tx, garageId: string): Promise<GarageSnapshot> {
  const tables: Record<string, Row[]> = {}
  for (const spec of TABLE_SPECS) {
    tables[spec.key] = await spec.read(tx, garageId)
  }
  return { version: 1, garageId, createdAt: new Date().toISOString(), tables }
}

/** Per-table row counts (used for backup metadata and verification). */
export function countTables(snapshot: GarageSnapshot): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const spec of TABLE_SPECS) counts[spec.key] = snapshot.tables[spec.key]?.length ?? 0
  return counts
}

/**
 * Atomically replace a garage's data with a snapshot: delete child→parent, then
 * re-create parent→child. Prisma coerces ISO date strings to DateTime.
 */
export async function restoreSnapshot(tx: Tx, snapshot: GarageSnapshot): Promise<Record<string, number>> {
  const restored: Record<string, number> = {}
  // Delete in reverse (child → parent).
  for (let i = TABLE_SPECS.length - 1; i >= 0; i--) {
    await TABLE_SPECS[i].del(tx, snapshot.garageId)
  }
  // Re-create in order (parent → child).
  for (const spec of TABLE_SPECS) {
    const rows = snapshot.tables[spec.key] ?? []
    if (rows.length > 0) await spec.create(tx, rows)
    restored[spec.key] = rows.length
  }
  return restored
}

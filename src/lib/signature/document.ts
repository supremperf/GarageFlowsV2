/**
 * Build the *signable document* — the whitelist of fields whose modification
 * after signing must invalidate the signature. Anything not included here (e.g.
 * updatedAt, internal flags) can change without breaking the seal.
 */
import type { SignableEntityType } from './types'

interface Line {
  description: string
  quantity: number
  unitPrice: number
  unitCost?: number
  isLabor?: boolean
  sortOrder?: number
}

function mapLines(lines: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(lines)) return []
  return (lines as Line[])
    .map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost ?? 0,
      isLabor: l.isLabor ?? false,
      sortOrder: l.sortOrder ?? 0,
    }))
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
}

/** Entity types this module can build a canonical document for today. */
export const SUPPORTED_ENTITY_TYPES: SignableEntityType[] = ['quote', 'invoice', 'work_order']

export function isSupportedEntityType(t: string): t is SignableEntityType {
  return (SUPPORTED_ENTITY_TYPES as string[]).includes(t)
}

/** Extract the meaningful, order-stable fields for the given entity type. */
export function buildSignableDocument(
  entityType: SignableEntityType,
  entity: Record<string, unknown>,
): Record<string, unknown> {
  switch (entityType) {
    case 'quote':
      return {
        type: 'quote',
        number: entity.number,
        clientName: entity.clientName,
        clientEmail: entity.clientEmail ?? null,
        vehicleModel: entity.vehicleModel ?? null,
        licensePlate: entity.licensePlate ?? null,
        taxRate: entity.taxRate,
        issueDate: entity.issueDate,
        validUntil: entity.validUntil ?? null,
        lines: mapLines(entity.lines),
      }
    case 'invoice':
      return {
        type: 'invoice',
        number: entity.number,
        clientName: entity.clientName,
        clientEmail: entity.clientEmail ?? null,
        vehicleModel: entity.vehicleModel ?? null,
        licensePlate: entity.licensePlate ?? null,
        taxRate: entity.taxRate,
        issueDate: entity.issueDate,
        dueDate: entity.dueDate ?? null,
        lines: mapLines(entity.lines),
      }
    case 'work_order':
      return {
        type: 'work_order',
        number: entity.number,
        clientName: entity.clientName,
        vehicleMake: entity.vehicleMake ?? null,
        vehicleModel: entity.vehicleModel ?? null,
        licensePlate: entity.licensePlate ?? null,
        mileage: entity.mileage ?? null,
        vin: entity.vin ?? null,
        worksJson: entity.worksJson ?? '[]',
        partsJson: entity.partsJson ?? '[]',
        taxRate: entity.taxRate,
        totalHT: entity.totalHT,
        totalTTC: entity.totalTTC,
      }
    default:
      return { type: entityType }
  }
}

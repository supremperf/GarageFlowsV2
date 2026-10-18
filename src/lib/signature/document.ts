/**
 * Build the *signable document* — the whitelist of fields whose modification
 * after signing must invalidate the signature. Anything not included here (e.g.
 * updatedAt, internal flags) can change without breaking the seal.
 */
import type { SignableEntityType } from './types'
import { fromScaled, fromCents } from '@/lib/money'

interface Line {
  description: string
  // Vue euros (historique) OU entiers exacts (stockage actuel) — les deux formes
  // sont acceptées et produisent le MÊME document canonique en euros.
  quantity?: number
  unitPrice?: number
  unitCost?: number
  quantityTenThousandths?: number
  unitPriceTenThousandths?: number
  unitCostTenThousandths?: number
  isLabor?: boolean
  sortOrder?: number
}

/**
 * IMPORTANT (compatibilité des signatures) : le document canonique est TOUJOURS
 * exprimé en EUROS (nombres), comme historiquement. La dérivation
 * `scaled/10000` est une division IEEE correctement arrondie → elle redonne
 * EXACTEMENT le même double que la valeur euro d'origine, donc le hachage des
 * documents déjà signés reste identique.
 */
function mapLines(lines: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(lines)) return []
  return (lines as Line[])
    .map((l) => ({
      description: l.description,
      quantity: l.quantity ?? fromScaled(l.quantityTenThousandths ?? 0),
      unitPrice: l.unitPrice ?? fromScaled(l.unitPriceTenThousandths ?? 0),
      unitCost: l.unitCost ?? fromScaled(l.unitCostTenThousandths ?? 0),
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
        // Euros canoniques, dérivés des CENTIMES stockés (mêmes doubles
        // qu'historiquement → hachages des documents signés inchangés).
        totalHT: entity.totalHT ?? fromCents((entity.totalHtCents as number) ?? 0),
        totalTTC: entity.totalTTC ?? fromCents((entity.totalTtcCents as number) ?? 0),
      }
    default:
      return { type: entityType }
  }
}

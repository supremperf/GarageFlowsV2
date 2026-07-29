/**
 * Supplier connectors — the pluggable boundary between the deterministic engine
 * and the outside world. Real integrations (TecDoc-style APIs, EDI, supplier
 * web services) implement `SupplierConnector`; the offline connectors below keep
 * the whole pipeline testable without network access.
 */
import type { PartQuery, SupplierConnector, SupplierOffer } from './types'

/** Accent- & case-insensitive key used to match a query against a catalogue. */
export function normalizeKey(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** One catalogue row a static supplier carries. */
export interface CatalogEntry {
  /** OEM/manufacturer reference (matched first, exactly & normalised). */
  reference?: string | null
  /** Human name (matched as a fallback when no reference is given). */
  name?: string | null
  /** Supplier's own SKU. */
  supplierRef?: string | null
  unitPrice: number
  /** Units in stock / deliverable. */
  availableQty: number
  leadTimeDays: number
  note?: string
}

export interface StaticSupplierConfig {
  id: string
  name: string
  favorite?: boolean
  catalog: CatalogEntry[]
}

/**
 * A connector backed by an in-memory catalogue. Deterministic — the same
 * queries always yield the same offers. Matching is by exact reference first
 * (accent-insensitive), then by normalised name.
 */
export class StaticConnector implements SupplierConnector {
  readonly id: string
  readonly name: string
  readonly favorite: boolean
  private readonly byRef = new Map<string, CatalogEntry>()
  private readonly byName = new Map<string, CatalogEntry>()

  constructor(config: StaticSupplierConfig) {
    this.id = config.id
    this.name = config.name
    this.favorite = config.favorite ?? false
    for (const entry of config.catalog) {
      const refKey = normalizeKey(entry.reference)
      const nameKey = normalizeKey(entry.name)
      if (refKey) this.byRef.set(refKey, entry)
      if (nameKey && !this.byName.has(nameKey)) this.byName.set(nameKey, entry)
    }
  }

  private match(query: PartQuery): CatalogEntry | undefined {
    const refKey = normalizeKey(query.reference)
    if (refKey && this.byRef.has(refKey)) return this.byRef.get(refKey)
    const skuKey = normalizeKey(query.supplierRef)
    if (skuKey && this.byRef.has(skuKey)) return this.byRef.get(skuKey)
    const nameKey = normalizeKey(query.name)
    if (nameKey && this.byName.has(nameKey)) return this.byName.get(nameKey)
    return undefined
  }

  async quote(queries: PartQuery[]): Promise<SupplierOffer[]> {
    const offers: SupplierOffer[] = []
    for (const q of queries) {
      const entry = this.match(q)
      if (!entry || entry.availableQty <= 0) continue
      offers.push({
        supplierId: this.id,
        supplierName: this.name,
        partId: q.partId,
        reference: entry.reference ?? q.reference ?? null,
        supplierRef: entry.supplierRef ?? q.supplierRef ?? null,
        unitPrice: entry.unitPrice,
        availableQty: entry.availableQty,
        requestedQty: q.quantity,
        leadTimeDays: entry.leadTimeDays,
        favorite: this.favorite,
        note: entry.note,
      })
    }
    return offers
  }
}

/**
 * A connector that echoes a single fixed offer per query — useful as a
 * last-resort fallback (« sur commande ») or in tests. Every requested part is
 * quoted at `unitPrice` with the configured lead time, always in full.
 */
export class FallbackConnector implements SupplierConnector {
  readonly id: string
  readonly name: string
  readonly favorite = false

  constructor(
    id: string,
    name: string,
    private readonly opts: { unitPrice: number; leadTimeDays: number; note?: string },
  ) {
    this.id = id
    this.name = name
  }

  async quote(queries: PartQuery[]): Promise<SupplierOffer[]> {
    return queries.map((q) => ({
      supplierId: this.id,
      supplierName: this.name,
      partId: q.partId,
      reference: q.reference ?? null,
      supplierRef: q.supplierRef ?? null,
      unitPrice: this.opts.unitPrice,
      availableQty: q.quantity,
      requestedQty: q.quantity,
      leadTimeDays: this.opts.leadTimeDays,
      favorite: false,
      note: this.opts.note ?? 'Sur commande',
    }))
  }
}

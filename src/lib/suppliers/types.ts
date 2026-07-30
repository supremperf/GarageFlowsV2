/**
 * Automatic supplier ordering — domain types. Framework-free & serialisable.
 *
 * The engine is deterministic: connectors return offers, the comparator ranks
 * them, and grouped orders are built per supplier. Real supplier integrations
 * (APIs, EDI, e-mail catalogues) plug in behind the `SupplierConnector`
 * interface without touching the core.
 */

/** A part the garage needs to source. `reference` is the OEM/manufacturer ref. */
export interface PartQuery {
  /** Local part id (echoed back so the caller can reconcile). */
  partId: string
  /** Human name (e.g. « Plaquettes de frein avant »). */
  name: string
  /** OEM / manufacturer reference used to match a supplier's catalogue. */
  reference?: string | null
  /** How many units are needed. Must be ≥ 1. */
  quantity: number
  /** Optional preferred/known supplier reference (supplier SKU). */
  supplierRef?: string | null
}

/** A single offer from one supplier for one `PartQuery`. */
export interface SupplierOffer {
  supplierId: string
  supplierName: string
  partId: string
  reference?: string | null
  /** Supplier's own SKU for the matched item. */
  supplierRef?: string | null
  /** Unit price excl. tax, in the garage's currency. */
  unitPrice: number
  /** Units the supplier can actually deliver (may be < requested). */
  availableQty: number
  /** Requested quantity (echoed from the query for convenience). */
  requestedQty: number
  /** Estimated delivery lead time in days. */
  leadTimeDays: number
  /** True when the supplier is flagged as a favourite for this garage. */
  favorite: boolean
  /** Free-form label surfaced to the user (« Stock local », « Sur commande »). */
  note?: string
}

/** Why a given offer was (not) selected — makes the ranking explainable. */
export interface OfferRanking {
  offer: SupplierOffer
  /** Rank position (0 = best). */
  rank: number
  /** True when this offer was picked to fulfil the line. */
  selected: boolean
  /** Can the supplier fully cover the requested quantity? */
  canFulfill: boolean
  /** Short human explanation of the ranking decision. */
  reason: string
}

/** Ranking outcome for one requested part across every supplier. */
export interface LineComparison {
  partId: string
  name: string
  requestedQty: number
  rankings: OfferRanking[]
  /** The winning offer, or null when nobody can supply the part. */
  best: SupplierOffer | null
  /** True when even the best offer cannot cover the full quantity. */
  shortfall: boolean
}

// ── Orders ────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'draft'      // being assembled, nothing sent
  | 'sent'       // transmitted to the supplier
  | 'confirmed'  // supplier acknowledged
  | 'received'   // goods delivered & checked in
  | 'cancelled'  // aborted before receipt
  | 'returned'   // received then returned

export interface OrderLine {
  partId: string
  name: string
  reference?: string | null
  supplierRef?: string | null
  quantity: number
  unitPrice: number
  /** quantity × unitPrice, rounded to cents. */
  lineTotal: number
}

export interface Order {
  /** Stable id within a grouping run (`supplierId`); the API assigns real ids. */
  supplierId: string
  supplierName: string
  status: OrderStatus
  lines: OrderLine[]
  /** Sum of all line totals, excl. tax, rounded to cents. */
  totalHT: number
  /** Worst (largest) lead time across the lines — when the order is complete. */
  maxLeadTimeDays: number
}

/** A ranking + the grouped draft orders derived from it. */
export interface OrderPlan {
  comparisons: LineComparison[]
  orders: Order[]
  /** Lines nobody could supply (informational). */
  unfulfillable: { partId: string; name: string; requestedQty: number }[]
  summary: {
    parts: number
    suppliers: number
    totalHT: number
    unfulfillable: number
  }
}

// ── Connector contract ─────────────────────────────────────────────────────────

/**
 * A supplier integration. `quote` is async so real connectors can hit an API;
 * the offline `StaticConnector` resolves immediately from an in-memory catalogue.
 * A connector may return zero offers (part not carried) and must never throw for
 * a simple "not found" — reserve throwing for transport/credential failures.
 */
export interface SupplierConnector {
  readonly id: string
  readonly name: string
  /** Favourite suppliers win ties in the comparator. */
  readonly favorite: boolean
  quote(queries: PartQuery[]): Promise<SupplierOffer[]>
}

export interface CompareOptions {
  /** Cap the ranked offers kept per line (default: all). */
  maxOffersPerLine?: number
  /**
   * Relative price tolerance (0–1) within which a favourite supplier still wins
   * a slightly-more-expensive offer. Default 0.05 (5 %).
   */
  favoriteTolerance?: number
}

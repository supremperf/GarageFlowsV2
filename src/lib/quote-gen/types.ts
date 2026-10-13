/**
 * Assisted quote generation — domain types. Framework-free & serialisable.
 *
 * The engine assembles a structured quote **proposal** from repair operations
 * (labour + their default parts) plus complementary suggestions, and computes
 * HT / VAT / TTC totals and margin. It is deterministic and never persists —
 * the proposal is confirmed by the user before an actual quote is created.
 */

export interface QuotePartInput {
  /**
   * Pièce du catalogue dont cette ligne provient (GF-040).
   *
   * Seul `InvoiceLine.partId` engage le stock : la facture issue de la
   * conversion d'un devis ne décrémentait donc RIEN, parce que le devis généré
   * ne transportait pas l'identifiant. Les pièces sortaient physiquement de
   * l'atelier sans jamais quitter l'inventaire.
   */
  partId?: string | null
  name: string
  reference?: string | null
  /** Selling price excl. tax. */
  unitPrice: number
  /** Purchase cost excl. tax (for the margin calculation). */
  unitCost?: number
  quantity: number
}

/** One operation to quote: its estimated labour and its default parts. */
export interface QuoteOperation {
  repairType: string
  label: string
  /** Estimated labour in minutes. */
  laborMinutes: number
  parts?: QuotePartInput[]
}

/** A complementary item proposed (e.g. from the forgotten-parts engine). */
export interface QuoteSuggestionInput {
  /** Pièce du catalogue d'où vient la suggestion, si elle en a une (GF-040). */
  partId?: string | null
  name: string
  reference?: string | null
  /** Selling price excl. tax, or null when unknown. */
  unitPrice: number | null
  quantity: number
  reason: string
}

export interface GenerateQuoteOptions {
  /** Labour rate excl. tax, per hour. */
  laborRatePerHour: number
  /** VAT rate in percent (default 20). */
  vatRate?: number
  /** Currency code (default EUR). */
  currency?: string
  /** Round billed hours up to this step (default 0.25 h). */
  laborStepHours?: number
}

export type QuoteLineKind = 'labor' | 'part'

export interface QuoteLine {
  kind: QuoteLineKind
  /** Pièce du catalogue à rattacher à la ligne du devis (GF-040). */
  partId?: string | null
  description: string
  reference?: string | null
  quantity: number
  unitPrice: number
  unitCost: number
  lineTotalHT: number
  isLabor: boolean
  repairType?: string
}

/** A suggested optional line — not counted in the quote totals. */
export interface SuggestionLine {
  /** Pièce du catalogue d'où vient la suggestion (GF-040). */
  partId?: string | null
  name: string
  reference?: string | null
  quantity: number
  unitPrice: number | null
  lineTotalHT: number | null
  reason: string
}

export interface QuoteTotals {
  laborHT: number
  partsHT: number
  subtotalHT: number
  vatRate: number
  vat: number
  totalTTC: number
  /** Parts purchase cost (labour cost is not modelled). */
  estimatedCostHT: number
  marginHT: number
  /** Margin as a percentage of subtotal HT, or null when subtotal is 0. */
  marginPct: number | null
  /** Total HT of the optional suggestions (priced ones only). */
  suggestionsHT: number
  currency: string
}

export interface QuoteProposal {
  lines: QuoteLine[]
  suggestions: SuggestionLine[]
  totals: QuoteTotals
  /** Total estimated labour across all operations, in minutes. */
  laborMinutes: number
  warnings: string[]
}

/**
 * Billing helpers — shared TVA / invoice calculation utilities.
 *
 * Single source of truth used by API routes (invoices, quotes, stats)
 * and unit tests. All monetary values are in the garage's currency (€ by default).
 */

export interface BillingLine {
  quantity:  number
  unitPrice: number
}

/** Sum of all lines before tax (HT). Raw float — call roundCents() before display. */
export function calcTotalHT(lines: BillingLine[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
}

/** Total after tax (TTC) for the given TVA rate (e.g. 20 for 20%). */
export function calcTotalTTC(lines: BillingLine[], taxRate: number): number {
  return calcTotalHT(lines) * (1 + taxRate / 100)
}

/** TVA amount only (TTC − HT). */
export function calcTaxAmount(lines: BillingLine[], taxRate: number): number {
  return calcTotalTTC(lines, taxRate) - calcTotalHT(lines)
}

/** Round a monetary value to 2 decimal places. */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Attach computed totalHT and totalTTC to a document that has `.lines` and `.taxRate`.
 * Mutates nothing — returns a new spread object.
 */
export function withTotals<T extends { lines: BillingLine[]; taxRate: number }>(doc: T) {
  return {
    ...doc,
    totalHT:  roundCents(calcTotalHT(doc.lines)),
    totalTTC: roundCents(calcTotalTTC(doc.lines, doc.taxRate)),
  }
}

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

/**
 * Round a monetary value to 2 decimal places (cents), half-away-from-zero.
 *
 * A naive Math.round(n*100)/100 mis-rounds values whose exact decimal lands on a
 * half-cent because IEEE-754 cannot represent them (e.g. 1.005 is stored as
 * 1.00499999…, rounding DOWN to 1.00). We add a tiny epsilon in the cents domain
 * to counteract that representation error before rounding. 1e-6 cents is far
 * larger than the FP error at invoice magnitudes yet far smaller than any real
 * sub-cent value, so genuine amounts are unaffected.
 */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(n) * 100 + 1e-6)) / 100
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

/**
 * Billing helpers — shared TVA / invoice calculation utilities.
 *
 * Single source of truth used by API routes (invoices, quotes, stats) and tests.
 * Tous les calculs délèguent à `lib/money.ts` (ENTIERS de centimes) : plus aucune
 * arithmétique financière en flottants JavaScript. Garantit TTC = HT + TVA.
 */
import { computeTotals, fromCents, toCents, type MoneyLine } from '@/lib/money'

export interface BillingLine {
  quantity:  number
  unitPrice: number
}

/** Sum of all lines before tax (HT), calculé en centimes puis rendu en euros. */
export function calcTotalHT(lines: BillingLine[]): number {
  return computeTotals(lines as MoneyLine[], 0).totalHT
}

/** Total after tax (TTC) for the given TVA rate (e.g. 20 for 20%). */
export function calcTotalTTC(lines: BillingLine[], taxRate: number): number {
  return computeTotals(lines as MoneyLine[], taxRate).totalTTC
}

/** TVA amount only (TTC − HT). */
export function calcTaxAmount(lines: BillingLine[], taxRate: number): number {
  return computeTotals(lines as MoneyLine[], taxRate).taxAmount
}

/** Round a monetary value to 2 decimal places (via centimes entiers). */
export function roundCents(n: number): number {
  return fromCents(toCents(n))
}

/**
 * Attach computed totalHT and totalTTC to a document that has `.lines` and `.taxRate`.
 * Mutates nothing — returns a new spread object. Calcul exact (centimes).
 */
export function withTotals<T extends { lines: BillingLine[]; taxRate: number }>(doc: T) {
  const t = computeTotals(doc.lines as MoneyLine[], doc.taxRate)
  return {
    ...doc,
    totalHT:  t.totalHT,
    totalTTC: t.totalTTC,
  }
}

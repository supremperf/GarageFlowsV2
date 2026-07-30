/**
 * Assisted quote generation — public entry point.
 *
 *   import { generateQuote } from '@/lib/quote-gen'
 *
 *   const proposal = generateQuote(operations, suggestions, { laborRatePerHour: 60 })
 *   // → { lines, suggestions, totals: { subtotalHT, vat, totalTTC, marginPct }, warnings }
 *
 * Deterministic: labour from estimated durations × rate, default parts, VAT and
 * margin. Suggestions are optional and excluded from the totals. Never persists
 * — the proposal is confirmed before a real quote is created.
 */
export * from './types'
export { generateQuote, roundMoney, billedHours } from './generate'

/**
 * Profitability analytics — public entry point.
 *
 *   import { analyze } from '@/lib/profitability'
 *   const report = analyze({ invoices, jobParts, parts })
 *
 * Deterministic: margin per invoice / client / vehicle / make / mechanic / part,
 * plus anomaly detection (dormant stock, low/negative-margin invoices, deficit
 * clients, parts sold at a loss) and concrete improvement recommendations.
 */
export * from './types'
export {
  analyze,
  lineMargin,
  invoiceMargin,
  byDimension,
  marginByPart,
  detectDormantStock,
} from './analyze'

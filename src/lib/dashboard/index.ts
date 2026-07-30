/**
 * Decision dashboard — public entry point.
 *
 *   import { buildDashboard } from '@/lib/dashboard'
 *
 *   const dash = buildDashboard({ kpis, insights, period })
 *   // → { kpis: [{ value, trend, deltaPct, status }], healthScore, insights, summary }
 *
 * Deterministic: KPIs with trend + status, a composite health score, and
 * prioritised insights. The API feeds it real data from the other engines.
 */
export * from './types'
export { buildDashboard, computeKpi, kpiStatus, deltaPct } from './build'

/**
 * Proactive assistant — public entry point.
 *
 *   import { buildAlerts } from '@/lib/proactive'
 *   const alerts = buildAlerts({ stock, quotes, overload, overdue, ct, vip })
 *
 * Composes signals from the other engines into prioritized, actionable alerts —
 * the assistant surfaces issues before you ask.
 */
export * from './types'
export { buildAlerts } from './engine'

/**
 * Predictive stock (reorder planning) — public entry point.
 *
 *   import { computeReorderPlan, planReorders } from '@/lib/stock-forecast'
 *
 * Combines the forecast engine with inventory theory to produce explainable
 * reorder plans: safety stock, reorder point, recommended quantity, best order
 * date and urgency, each with a rationale.
 */
export * from './types'
export { computeReorderPlan, planReorders } from './plan'

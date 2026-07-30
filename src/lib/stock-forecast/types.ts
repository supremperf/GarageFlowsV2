/**
 * Predictive stock (reorder planning) — shared types.
 *
 * Combines the forecast engine (expected consumption) with classic inventory
 * theory (safety stock, reorder point, order-up-to level) to produce an
 * explainable reorder plan per part.
 */

export type Urgency = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface StockItemInput {
  id: string
  name: string
  reference?: string | null
  currentStock: number
  unitCost: number
  /** Configured low-stock threshold (Part.minQuantity). */
  minStock?: number
  /** Supplier lead time in days (default 7). */
  leadTimeDays?: number
  /** Length in days of one consumption bucket (default 30 = monthly). */
  periodDays?: number
  /** Order multiple / pack size (default 1). */
  packSize?: number
  /** Safety factor (z). Default 1.28 ≈ 90% service level. */
  serviceZ?: number
}

export interface ReorderPlan {
  id: string
  name: string
  reference?: string | null
  currentStock: number
  /** Mean historical consumption per period. */
  avgConsumptionPerPeriod: number
  /** Forecast consumption for the next period (from the forecast engine). */
  forecastNextPeriod: number
  dailyRate: number
  daysToStockout: number | null
  safetyStock: number
  reorderPoint: number
  shouldReorder: boolean
  recommendedOrderQty: number
  estimatedCost: number
  /** Days from now by which the order should be placed to avoid a stockout. */
  bestOrderInDays: number | null
  urgency: Urgency
  rationale: string[]
}

export interface StockForecastSummary {
  itemsAnalyzed: number
  itemsToReorder: number
  totalOrderCost: number
  currency: string
}

export interface StockForecastReport {
  plans: ReorderPlan[]
  summary: StockForecastSummary
}

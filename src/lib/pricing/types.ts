/**
 * Pricing optimizer — shared types.
 *
 * "Marge" here is the margin on revenue: marginPct = (price − cost) / price × 100
 * (French taux de marge). Elasticity-based volume/profit estimates are only
 * produced when a baseline volume and current price are provided.
 */

export interface PricingInput {
  unitCost: number
  currentPrice?: number
  /** Desired margin on revenue (%). Default 35. */
  targetMarginPct?: number
  /** Floor margin on revenue (%). Default 10. */
  minMarginPct?: number
  competitorPrice?: number
  /** Price elasticity of demand (negative). Default -1.2. */
  elasticity?: number
  /** Units sold at currentPrice, for the profit estimate. */
  baselineVolume?: number
  /** Seasonal multiplier (e.g. 1.1 in peak). Default 1. */
  seasonFactor?: number
  /** Loyalty discount for the target customer (%). Default 0. */
  loyaltyDiscountPct?: number
  currency?: string
}

export interface ScenarioResult {
  label: string
  price: number
  marginPct: number
  marginAbs: number
  estVolume: number | null
  estRevenue: number | null
  estProfit: number | null
}

export interface PricingRecommendation {
  currency: string
  unitCost: number
  recommendedPrice: number
  marginPct: number
  marginAbs: number
  floorPrice: number
  targetPrice: number
  competitorPrice: number | null
  rationale: string[]
  scenarios: ScenarioResult[]
}

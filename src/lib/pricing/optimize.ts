/**
 * Pricing optimizer — pure, deterministic.
 */
import type { PricingInput, PricingRecommendation, ScenarioResult } from './types'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Price achieving a target margin on revenue: price = cost / (1 − m). */
export function priceForMargin(cost: number, marginPct: number): number {
  const m = Math.min(0.95, Math.max(0, marginPct / 100))
  if (cost <= 0) return 0
  return round2(cost / (1 - m))
}

/** Margin on revenue (%) for a given price. */
export function marginPctOf(price: number, cost: number): number {
  if (price <= 0) return 0
  return Math.round(((price - cost) / price) * 1000) / 10
}

/** Elasticity-based volume/revenue/profit estimate at a candidate price. */
export function estimate(
  input: PricingInput,
  price: number,
): { estVolume: number | null; estRevenue: number | null; estProfit: number | null } {
  if (input.baselineVolume == null || input.currentPrice == null || input.currentPrice <= 0) {
    return { estVolume: null, estRevenue: null, estProfit: null }
  }
  const elasticity = input.elasticity ?? -1.2
  const priceChange = (price - input.currentPrice) / input.currentPrice
  const estVolume = Math.max(0, input.baselineVolume * (1 + elasticity * priceChange))
  return {
    estVolume: round2(estVolume),
    estRevenue: round2(price * estVolume),
    estProfit: round2((price - input.unitCost) * estVolume),
  }
}

function scenario(input: PricingInput, label: string, price: number): ScenarioResult {
  const p = round2(price)
  return { label, price: p, marginPct: marginPctOf(p, input.unitCost), marginAbs: round2(p - input.unitCost), ...estimate(input, p) }
}

/** Evaluate a list of candidate prices; sorted by estimated profit (desc), nulls last. */
export function simulateScenarios(input: PricingInput, prices: number[]): ScenarioResult[] {
  const out = prices.map((p, i) => scenario(input, `option_${i + 1}`, p))
  return out.sort((a, b) => (b.estProfit ?? -Infinity) - (a.estProfit ?? -Infinity))
}

export function recommendPrice(input: PricingInput): PricingRecommendation {
  const cost = input.unitCost
  const targetMarginPct = input.targetMarginPct ?? 35
  const minMarginPct = input.minMarginPct ?? 10
  const seasonFactor = input.seasonFactor ?? 1
  const loyalty = input.loyaltyDiscountPct ?? 0
  const currency = input.currency ?? 'EUR'

  const floorPrice = priceForMargin(cost, minMarginPct)
  const targetPrice = priceForMargin(cost, targetMarginPct)

  // Start at the target; stay at or below a known competitor to remain
  // competitive; apply season & loyalty; never fall below the margin floor.
  let price = targetPrice
  if (input.competitorPrice != null) price = Math.min(price, input.competitorPrice)
  price = price * seasonFactor * (1 - loyalty / 100)
  price = Math.max(price, floorPrice)
  price = round2(price)

  const rationale: string[] = []
  rationale.push(`Prix cible à ${targetMarginPct}% de marge : ${targetPrice} ${currency}.`)
  rationale.push(`Prix plancher à ${minMarginPct}% de marge : ${floorPrice} ${currency}.`)
  if (input.competitorPrice != null) rationale.push(`Positionné au niveau ou sous le concurrent (${input.competitorPrice} ${currency}).`)
  if (seasonFactor !== 1) rationale.push(`Facteur saisonnier ${seasonFactor} appliqué.`)
  if (loyalty > 0) rationale.push(`Remise fidélité ${loyalty}% appliquée.`)
  rationale.push(`Prix recommandé : ${price} ${currency} (marge ${marginPctOf(price, cost)}%).`)

  // Scenario set.
  const scenarios: ScenarioResult[] = [
    scenario(input, 'recommandé', price),
    scenario(input, 'plancher', floorPrice),
    scenario(input, 'cible', targetPrice),
  ]
  if (input.competitorPrice != null) scenarios.push(scenario(input, 'concurrent', input.competitorPrice))

  // Profit-maximizing scan (only when estimates are available).
  if (input.baselineVolume != null && input.currentPrice != null && input.currentPrice > 0) {
    const lo = floorPrice
    const hi = round2(targetPrice * 1.5)
    let best: ScenarioResult | null = null
    for (let i = 0; i <= 20; i++) {
      const p = lo + ((hi - lo) * i) / 20
      const s = scenario(input, 'profit_max', p)
      if (!best || (s.estProfit ?? -Infinity) > (best.estProfit ?? -Infinity)) best = s
    }
    if (best) scenarios.push(best)
  }

  return {
    currency,
    unitCost: cost,
    recommendedPrice: price,
    marginPct: marginPctOf(price, cost),
    marginAbs: round2(price - cost),
    floorPrice,
    targetPrice,
    competitorPrice: input.competitorPrice ?? null,
    rationale,
    scenarios,
  }
}

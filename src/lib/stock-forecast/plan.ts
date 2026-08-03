/**
 * Predictive reorder planning — pure, deterministic.
 */
import { forecast } from '@/lib/forecast'
import { mean, stddev } from '@/lib/forecast'
import type {
  ReorderPlan,
  StockForecastReport,
  StockItemInput,
  Urgency,
} from './types'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function ceilToPack(qty: number, packSize: number): number {
  if (packSize <= 1) return Math.max(0, Math.ceil(qty))
  return Math.max(0, Math.ceil(qty / packSize) * packSize)
}

/**
 * Compute a reorder plan for one item given its per-period consumption history
 * (oldest → newest). Empty history means no observed demand.
 */
export function computeReorderPlan(item: StockItemInput, consumption: number[]): ReorderPlan {
  const leadTimeDays = item.leadTimeDays ?? 7
  const periodDays = item.periodDays ?? 30
  const packSize = item.packSize ?? 1
  const z = item.serviceZ ?? 1.28
  const minStock = item.minStock ?? 0

  const history = consumption.filter((c) => Number.isFinite(c) && c >= 0)
  const avg = round2(mean(history))
  const forecastNext = history.length
    ? Math.max(0, forecast(history, { horizon: 1 }).points[0].value)
    : 0
  // Use the forecast as the demand estimate, but never below the recent average
  // (avoids under-ordering when the trend dips on noisy data).
  const perPeriodDemand = Math.max(forecastNext, avg)
  const dailyRate = periodDays > 0 ? perPeriodDemand / periodDays : 0

  // Safety stock: z × demand std scaled to the lead-time window.
  const periodStd = stddev(history)
  // Garde periodDays > 0 (comme dailyRate ci-dessus) : sinon division par zéro →
  // sqrt(Infinity) → NaN/Infinity propagé dans tout le plan (safetyStock,
  // reorderPoint, estimatedCost) sérialisé en null. La route passe 30 en dur,
  // mais d'autres appelants (proactive/copilot/dashboard) ne sont pas gardés.
  const leadTimeStd = periodDays > 0 ? periodStd * Math.sqrt(leadTimeDays / periodDays) : 0
  const safetyStock = Math.ceil(z * leadTimeStd)

  const reorderPoint = Math.ceil(dailyRate * leadTimeDays + safetyStock)
  const daysToStockout = dailyRate > 0 ? round2(item.currentStock / dailyRate) : null

  const belowMin = minStock > 0 && item.currentStock <= minStock
  const shouldReorder = item.currentStock <= reorderPoint || belowMin

  // Order up to cover the lead time + one review period, but never below the
  // configured minimum stock floor.
  const targetStock = Math.max(
    Math.ceil(dailyRate * (leadTimeDays + periodDays) + safetyStock),
    minStock,
  )
  const recommendedOrderQty = shouldReorder ? ceilToPack(targetStock - item.currentStock, packSize) : 0
  const estimatedCost = round2(recommendedOrderQty * item.unitCost)

  const bestOrderInDays =
    daysToStockout === null ? null : Math.max(0, Math.floor(daysToStockout - leadTimeDays))

  let urgency: Urgency
  if (!shouldReorder && daysToStockout === null) urgency = 'none'
  else if (shouldReorder && (daysToStockout === null ? belowMin : daysToStockout <= leadTimeDays)) urgency = 'critical'
  else if (shouldReorder) urgency = 'high'
  else if (bestOrderInDays !== null && bestOrderInDays <= periodDays) urgency = 'medium'
  else urgency = 'low'

  const rationale: string[] = []
  rationale.push(`Consommation moyenne ${avg}/période, prévision prochaine période ${round2(forecastNext)}.`)
  if (daysToStockout !== null) rationale.push(`Rupture estimée dans ~${daysToStockout} jour(s) au rythme actuel.`)
  rationale.push(`Point de commande ${reorderPoint} (délai ${leadTimeDays} j + stock de sécurité ${safetyStock}).`)
  if (belowMin) rationale.push(`Sous le seuil configuré (${minStock}).`)
  if (shouldReorder) rationale.push(`Commander ${recommendedOrderQty} pour couvrir le délai + une période.`)

  return {
    id: item.id,
    name: item.name,
    reference: item.reference ?? null,
    currentStock: item.currentStock,
    avgConsumptionPerPeriod: avg,
    forecastNextPeriod: round2(forecastNext),
    dailyRate: round2(dailyRate),
    daysToStockout,
    safetyStock,
    reorderPoint,
    shouldReorder,
    recommendedOrderQty,
    estimatedCost,
    bestOrderInDays,
    urgency,
    rationale,
  }
}

const URGENCY_ORDER: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }

/** Plan reorders for many items; sorted by urgency, then soonest stockout. */
export function planReorders(
  items: Array<{ item: StockItemInput; consumption: number[] }>,
  currency = 'EUR',
): StockForecastReport {
  const plans = items.map(({ item, consumption }) => computeReorderPlan(item, consumption))
  plans.sort((a, b) => {
    if (URGENCY_ORDER[a.urgency] !== URGENCY_ORDER[b.urgency]) return URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    return (a.daysToStockout ?? Infinity) - (b.daysToStockout ?? Infinity)
  })

  const toReorder = plans.filter((p) => p.shouldReorder)
  return {
    plans,
    summary: {
      itemsAnalyzed: plans.length,
      itemsToReorder: toReorder.length,
      totalOrderCost: round2(toReorder.reduce((s, p) => s + p.estimatedCost, 0)),
      currency,
    },
  }
}

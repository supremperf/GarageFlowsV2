/**
 * Offer comparison & order grouping. Pure & deterministic.
 *
 * Ranking priority, per requested part:
 *   1. can fulfil the full quantity (full-cover offers beat partial ones)
 *   2. lower effective price — with a tolerance band inside which a favourite
 *      supplier is preferred even if marginally more expensive
 *   3. shorter lead time
 *   4. favourite flag, then supplier name (stable tie-break)
 */
import type {
  CompareOptions,
  LineComparison,
  OfferRanking,
  Order,
  OrderLine,
  OrderPlan,
  PartQuery,
  SupplierOffer,
} from './types'

/** Float-safe rounding to cents. */
export function roundMoney(n: number): number {
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(n) * 100 + 1e-6)) / 100
}

function canFulfill(o: SupplierOffer): boolean {
  return o.availableQty >= o.requestedQty
}

/**
 * Rank the offers for a single requested part. Offers not belonging to `query`
 * (different partId) are ignored defensively.
 */
export function rankLine(
  query: PartQuery,
  offers: SupplierOffer[],
  opts: CompareOptions = {},
): LineComparison {
  const tolerance = opts.favoriteTolerance ?? 0.05
  const relevant = offers.filter((o) => o.partId === query.partId)

  const sorted = relevant.slice().sort((a, b) => {
    const fa = canFulfill(a) ? 0 : 1
    const fb = canFulfill(b) ? 0 : 1
    if (fa !== fb) return fa - fb

    // Favourite tolerance band: a favourite within `tolerance` of the cheaper
    // offer is treated as equal on price, then wins on the favourite tie-break.
    const cheaper = Math.min(a.unitPrice, b.unitPrice)
    const band = cheaper * tolerance
    const priceDiff = a.unitPrice - b.unitPrice
    if (Math.abs(priceDiff) > band) return priceDiff

    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    if (a.leadTimeDays !== b.leadTimeDays) return a.leadTimeDays - b.leadTimeDays
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice
    return a.supplierName.localeCompare(b.supplierName)
  })

  const capped = opts.maxOffersPerLine != null ? sorted.slice(0, opts.maxOffersPerLine) : sorted
  const bestOffer = sorted[0] ?? null

  const rankings: OfferRanking[] = capped.map((offer, i) => {
    const full = canFulfill(offer)
    const selected = offer === bestOffer
    const reasons: string[] = []
    if (selected) reasons.push('Meilleure offre')
    if (offer.favorite) reasons.push('Fournisseur favori')
    if (!full) reasons.push(`Couvre ${offer.availableQty}/${offer.requestedQty}`)
    reasons.push(`${offer.unitPrice} €/u`)
    reasons.push(`${offer.leadTimeDays} j`)
    return {
      offer,
      rank: i,
      selected,
      canFulfill: full,
      reason: reasons.join(' · '),
    }
  })

  return {
    partId: query.partId,
    name: query.name,
    requestedQty: query.quantity,
    rankings,
    best: bestOffer,
    shortfall: bestOffer ? !canFulfill(bestOffer) : true,
  }
}

/**
 * Build one draft order per supplier from the winning offers. Each line orders
 * the requested quantity capped at what the supplier can actually deliver.
 * Orders are returned sorted by supplier name for deterministic output.
 */
export function buildGroupedOrders(comparisons: LineComparison[]): Order[] {
  const bySupplier = new Map<string, Order>()

  for (const c of comparisons) {
    const offer = c.best
    if (!offer) continue
    const quantity = Math.min(c.requestedQty, offer.availableQty)
    if (quantity <= 0) continue

    const line: OrderLine = {
      partId: c.partId,
      name: c.name,
      reference: offer.reference ?? null,
      supplierRef: offer.supplierRef ?? null,
      quantity,
      unitPrice: offer.unitPrice,
      lineTotal: roundMoney(quantity * offer.unitPrice),
    }

    const order = bySupplier.get(offer.supplierId) ?? {
      supplierId: offer.supplierId,
      supplierName: offer.supplierName,
      status: 'draft' as const,
      lines: [],
      totalHT: 0,
      maxLeadTimeDays: 0,
    }
    order.lines.push(line)
    order.totalHT = roundMoney(order.totalHT + line.lineTotal)
    order.maxLeadTimeDays = Math.max(order.maxLeadTimeDays, offer.leadTimeDays)
    bySupplier.set(offer.supplierId, order)
  }

  return Array.from(bySupplier.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName))
}

/** Full comparison + grouping pipeline for a set of requested parts. */
export function buildOrderPlan(
  queries: PartQuery[],
  offers: SupplierOffer[],
  opts: CompareOptions = {},
): OrderPlan {
  const comparisons = queries.map((q) => rankLine(q, offers, opts))
  const orders = buildGroupedOrders(comparisons)
  const unfulfillable = comparisons
    .filter((c) => c.best == null)
    .map((c) => ({ partId: c.partId, name: c.name, requestedQty: c.requestedQty }))

  return {
    comparisons,
    orders,
    unfulfillable,
    summary: {
      parts: queries.length,
      suppliers: orders.length,
      totalHT: roundMoney(orders.reduce((s, o) => s + o.totalHT, 0)),
      unfulfillable: unfulfillable.length,
    },
  }
}

/**
 * Proactive assistant — shared types.
 *
 * Composes signals from the other engines (predictive stock, quotes, scheduling,
 * invoicing, CT, CRM) into a prioritized list of actionable alerts. The engine
 * is pure: the API gathers the signals and passes them in.
 */

export type AlertType =
  | 'stock_out_soon'
  | 'quote_pending'
  | 'mechanic_overload'
  | 'invoice_overdue'
  | 'ct_expiring'
  | 'vip_recall'

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface ProactiveAlert {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  /** Suggested next action (e.g. "Commander", "Relancer"). */
  actionLabel?: string
  /** Money at stake, when relevant. */
  amount?: number
  ref?: { id?: string; label?: string }
}

export interface StockSignal {
  name: string
  urgency: 'critical' | 'high' | 'medium' | 'low' | 'none'
  daysToStockout: number | null
  recommendedOrderQty: number
  estimatedCost?: number
  ref?: string
}
export interface QuoteSignal {
  number: string
  clientName: string
  ageDays: number
  amount: number
  id?: string
}
export interface OverloadSignal {
  name: string
  utilizationPct: number
  date: string
  id?: string
}
export interface OverdueSignal {
  number: string
  clientName: string
  amount: number
  overdueDays: number
  id?: string
}
export interface CtSignal {
  plate: string
  daysLeft: number
  id?: string
}
export interface VipSignal {
  name: string
  lastVisitDays: number
  totalSpent: number
  id?: string
}

export interface ProactiveInput {
  stock?: StockSignal[]
  quotes?: QuoteSignal[]
  overload?: OverloadSignal[]
  overdue?: OverdueSignal[]
  ct?: CtSignal[]
  vip?: VipSignal[]
}

export interface ProactiveOptions {
  quoteAgeDays?: number // pending-quote threshold (default 5)
  vipMinSpent?: number // VIP spend threshold (default 1000)
  vipMinInactiveDays?: number // recall threshold (default 120)
}

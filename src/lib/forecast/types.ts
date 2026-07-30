/**
 * Forecasting — shared types. Deterministic time-series prediction over a numeric
 * history (e.g. monthly revenue, appointment counts, stock consumption).
 */

export type ForecastMethod = 'linear' | 'moving_average' | 'seasonal_naive' | 'naive'

export type Trend = 'up' | 'down' | 'flat'
export type Confidence = 'high' | 'medium' | 'low'

export interface ForecastPoint {
  /** 0-based offset into the future (1 = next period). */
  step: number
  value: number
  lower: number
  upper: number
}

export interface ForecastResult {
  method: ForecastMethod
  points: ForecastPoint[]
  trend: Trend
  /** Per-period slope (0 for non-linear methods). */
  slope: number
  confidence: Confidence
  /** Coefficient of determination for the linear fit, else null. */
  r2: number | null
  /** Human-readable assumptions behind the forecast. */
  assumptions: string[]
  /** Expected / optimistic / pessimistic value paths over the horizon. */
  scenarios: { expected: number[]; optimistic: number[]; pessimistic: number[] }
}

export interface ForecastOptions {
  method?: 'auto' | ForecastMethod
  horizon?: number
  /** Seasonal period (e.g. 12 for monthly-yearly). Enables seasonal_naive. */
  seasonPeriod?: number
  /** Moving-average window. */
  window?: number
  /** z multiplier for the confidence interval (default 1.96 ≈ 95%). */
  z?: number
  /** Clamp forecasts at 0 (counts/amounts can't go negative). Default true. */
  nonNegative?: boolean
}

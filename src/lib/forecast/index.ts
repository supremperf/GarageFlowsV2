/**
 * Forecasting — public entry point.
 *
 *   import { forecast } from '@/lib/forecast'
 *   const result = forecast(monthlyRevenue, { horizon: 3, method: 'auto' })
 *
 * Deterministic: linear trend / moving average / seasonal-naive, auto-selected by
 * in-sample error, with confidence intervals, trend, assumptions and scenarios.
 */
export * from './types'
export { forecast } from './forecast'
export { mean, stddev, mae, linearRegression, movingAverage } from './stats'

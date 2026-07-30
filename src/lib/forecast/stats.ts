/**
 * Small, dependency-free statistics used by the forecaster.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Population standard deviation (divides by n). */
export function stddev(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export function mae(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length)
  if (n === 0) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(actual[i] - predicted[i])
  return s / n
}

export interface Regression {
  slope: number
  intercept: number
  r2: number
}

/**
 * Ordinary least-squares regression of y over x = 0..n-1.
 * r2 = 1 for a perfectly flat series (variance 0, residuals 0).
 */
export function linearRegression(y: number[]): Regression {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: n === 1 ? y[0] : 0, r2: 0 }
  const xs = Array.from({ length: n }, (_, i) => i)
  const mx = mean(xs)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (y[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const slope = sxx === 0 ? 0 : sxy / sxx
  const intercept = my - slope * mx

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * xs[i]
    ssRes += (y[i] - yhat) ** 2
    ssTot += (y[i] - my) ** 2
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

/** Trailing moving average of the last `window` values. */
export function movingAverage(ys: number[], window: number): number {
  if (ys.length === 0) return 0
  const w = Math.max(1, Math.min(window, ys.length))
  return mean(ys.slice(ys.length - w))
}

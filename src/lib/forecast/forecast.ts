/**
 * Deterministic time-series forecaster.
 *
 * Methods: linear trend (least squares), moving average, seasonal-naive, naive.
 * 'auto' picks the method with the lowest in-sample one-step error. Every
 * forecast carries a confidence interval, a trend, stated assumptions and
 * expected/optimistic/pessimistic scenarios.
 */
import { linearRegression, mean, movingAverage, stddev } from './stats'
import type {
  Confidence,
  ForecastMethod,
  ForecastOptions,
  ForecastResult,
  Trend,
} from './types'

interface Model {
  method: ForecastMethod
  forecastValue: (k: number) => number
  fittedPairs: Array<{ actual: number; pred: number }>
  slope: number
  r2: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildModel(method: ForecastMethod, history: number[], opts: ForecastOptions): Model {
  const n = history.length
  switch (method) {
    case 'linear': {
      const reg = linearRegression(history)
      return {
        method,
        forecastValue: (k) => reg.intercept + reg.slope * (n - 1 + k),
        fittedPairs: history.map((actual, i) => ({ actual, pred: reg.intercept + reg.slope * i })),
        slope: reg.slope,
        r2: reg.r2,
      }
    }
    case 'moving_average': {
      const w = Math.max(1, Math.min(opts.window ?? Math.min(3, n), n))
      const value = movingAverage(history, w)
      const pairs: Array<{ actual: number; pred: number }> = []
      for (let i = w; i < n; i++) pairs.push({ actual: history[i], pred: mean(history.slice(i - w, i)) })
      return { method, forecastValue: () => value, fittedPairs: pairs, slope: 0, r2: null }
    }
    case 'seasonal_naive': {
      const p = Math.max(1, opts.seasonPeriod ?? 1)
      const pairs: Array<{ actual: number; pred: number }> = []
      for (let i = p; i < n; i++) pairs.push({ actual: history[i], pred: history[i - p] })
      return {
        method,
        forecastValue: (k) => history[n - p + ((k - 1) % p)],
        fittedPairs: pairs,
        slope: 0,
        r2: null,
      }
    }
    case 'naive':
    default: {
      const last = n > 0 ? history[n - 1] : 0
      const pairs: Array<{ actual: number; pred: number }> = []
      for (let i = 1; i < n; i++) pairs.push({ actual: history[i], pred: history[i - 1] })
      return { method: 'naive', forecastValue: () => last, fittedPairs: pairs, slope: 0, r2: null }
    }
  }
}

function inSampleMae(m: Model): number {
  if (m.fittedPairs.length === 0) return Infinity
  return mean(m.fittedPairs.map((p) => Math.abs(p.actual - p.pred)))
}

function residualStd(m: Model): number {
  if (m.fittedPairs.length === 0) return 0
  return stddev(m.fittedPairs.map((p) => p.actual - p.pred))
}

function classifyTrend(slope: number, scale: number): Trend {
  const eps = 0.01 * Math.max(1, Math.abs(scale))
  if (slope > eps) return 'up'
  if (slope < -eps) return 'down'
  return 'flat'
}

function classifyConfidence(std: number, scale: number): Confidence {
  const rel = std / Math.max(1, Math.abs(scale))
  if (rel <= 0.05) return 'high'
  if (rel <= 0.2) return 'medium'
  return 'low'
}

export function forecast(history: number[], opts: ForecastOptions = {}): ForecastResult {
  const clean = history.filter((x) => Number.isFinite(x))
  const n = clean.length
  const horizon = Math.max(1, opts.horizon ?? 3)
  const z = opts.z ?? 1.96
  const nonNeg = opts.nonNegative !== false
  const avg = mean(clean)

  // Pick the method.
  let method: ForecastMethod
  if (opts.method && opts.method !== 'auto') {
    method = opts.method
  } else {
    const candidates: ForecastMethod[] = []
    if (n >= 2) candidates.push('linear')
    if (opts.seasonPeriod && n >= 2 * opts.seasonPeriod) candidates.push('seasonal_naive')
    if (n >= 1) candidates.push('moving_average')
    candidates.push('naive')
    // Lowest in-sample MAE wins; candidates array order breaks ties.
    method = candidates.reduce((best, cand) =>
      inSampleMae(buildModel(cand, clean, opts)) < inSampleMae(buildModel(best, clean, opts)) ? cand : best,
    candidates[0])
  }

  const model = buildModel(method, clean, opts)
  const std = residualStd(model)
  const trendSlope = model.slope !== 0 ? model.slope : linearRegression(clean).slope

  const clamp = (v: number) => (nonNeg ? Math.max(0, v) : v)
  const points = Array.from({ length: horizon }, (_, i) => {
    const k = i + 1
    const value = clamp(model.forecastValue(k))
    const half = z * std
    return {
      step: k,
      value: round2(value),
      lower: round2(clamp(value - half)),
      upper: round2(value + half),
    }
  })

  const assumptions: string[] = []
  const methodLabel: Record<ForecastMethod, string> = {
    linear: 'tendance linéaire (moindres carrés)',
    moving_average: 'moyenne mobile',
    seasonal_naive: 'saisonnier naïf',
    naive: 'naïf (dernière valeur)',
  }
  assumptions.push(`Modèle : ${methodLabel[method]}.`)
  assumptions.push(`${n} période(s) d'historique, horizon ${horizon}.`)
  if (method === 'seasonal_naive') assumptions.push(`Saisonnalité de période ${opts.seasonPeriod}.`)
  assumptions.push(`Intervalle de confiance à ~${Math.round((z >= 1.96 ? 0.95 : 0.9) * 100)} %.`)
  if (nonNeg) assumptions.push('Valeurs bornées à 0 (pas de valeur négative).')

  return {
    method,
    points,
    trend: classifyTrend(trendSlope, avg),
    slope: round2(model.slope),
    confidence: classifyConfidence(std, avg),
    r2: model.r2 === null ? null : Math.round(model.r2 * 1000) / 1000,
    assumptions,
    scenarios: {
      expected: points.map((p) => p.value),
      optimistic: points.map((p) => p.upper),
      pessimistic: points.map((p) => p.lower),
    },
  }
}

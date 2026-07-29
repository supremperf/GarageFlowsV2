import { describe, it, expect } from 'vitest'
import { forecast, linearRegression } from '../index'

describe('linearRegression', () => {
  it('fits a perfect line', () => {
    const r = linearRegression([10, 20, 30, 40])
    expect(r.slope).toBe(10)
    expect(r.intercept).toBe(10)
    expect(r.r2).toBe(1)
  })
  it('reports r2 = 1 for a flat series', () => {
    expect(linearRegression([5, 5, 5, 5])).toMatchObject({ slope: 0, r2: 1 })
  })
})

describe('forecast — linear', () => {
  it('extrapolates a perfect upward trend with tight interval', () => {
    const r = forecast([10, 20, 30, 40], { method: 'linear', horizon: 2 })
    expect(r.method).toBe('linear')
    expect(r.points.map((p) => p.value)).toEqual([50, 60])
    expect(r.points[0].lower).toBe(50) // residual std 0 → zero-width interval
    expect(r.points[0].upper).toBe(50)
    expect(r.trend).toBe('up')
    expect(r.confidence).toBe('high')
    expect(r.r2).toBe(1)
    expect(r.scenarios.expected).toEqual([50, 60])
  })

  it('is flat for a constant series', () => {
    const r = forecast([5, 5, 5, 5], { method: 'linear', horizon: 2 })
    expect(r.trend).toBe('flat')
    expect(r.points.map((p) => p.value)).toEqual([5, 5])
  })

  it('clamps negative forecasts to 0 by default', () => {
    const r = forecast([10, 7, 4, 1], { method: 'linear', horizon: 1 })
    expect(r.trend).toBe('down')
    expect(r.points[0].value).toBe(0)
    expect(r.points[0].lower).toBe(0)
  })
})

describe('forecast — moving average & seasonal', () => {
  it('averages the trailing window', () => {
    const r = forecast([2, 4, 6, 8], { method: 'moving_average', window: 2, horizon: 2 })
    expect(r.method).toBe('moving_average')
    expect(r.points.map((p) => p.value)).toEqual([7, 7]) // mean(6,8)
  })

  it('repeats the seasonal pattern', () => {
    const r = forecast([1, 2, 1, 2], { method: 'seasonal_naive', seasonPeriod: 2, horizon: 3 })
    expect(r.points.map((p) => p.value)).toEqual([1, 2, 1])
    expect(r.confidence).toBe('high') // perfect seasonal fit → zero residual
  })
})

describe('forecast — auto selection', () => {
  it('selects the linear model for a clean trend', () => {
    const r = forecast([10, 20, 30, 40], { method: 'auto', horizon: 1 })
    expect(r.method).toBe('linear')
    expect(r.points[0].value).toBe(50)
  })

  it('handles a single-point history gracefully', () => {
    const r = forecast([5], { horizon: 2 })
    expect(r.points.map((p) => p.value)).toEqual([5, 5])
  })

  it('always states its assumptions', () => {
    const r = forecast([3, 6, 9], { horizon: 1 })
    expect(r.assumptions.length).toBeGreaterThan(0)
    expect(r.assumptions.join(' ')).toMatch(/horizon/i)
  })
})

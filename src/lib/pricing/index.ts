/**
 * Pricing optimizer — public entry point.
 *
 *   import { recommendPrice, simulateScenarios } from '@/lib/pricing'
 *
 * Deterministic: recommended price by target margin, competitive positioning,
 * season/loyalty adjustments, margin floor, and elasticity-based scenario
 * simulation (including a profit-maximizing scan).
 */
export * from './types'
export { recommendPrice, simulateScenarios, priceForMargin, marginPctOf, estimate } from './optimize'

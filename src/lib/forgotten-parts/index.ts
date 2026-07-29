/**
 * Forgotten-parts recommender — public entry point.
 *
 *   import { forgottenPartsEngine } from '@/lib/forgotten-parts'
 *   const recs = forgottenPartsEngine.analyze({
 *     operations: ['Kit de distribution'],
 *     partsOnJob: [{ name: 'Pompe à eau' }],   // already added → not re-recommended
 *     catalog,                                  // reference|name → unit price
 *     garageHabits,                             // names the garage usually adds
 *   })
 *
 * Explainable: every recommendation carries a confidence level, a justification
 * and an estimated financial impact.
 */
export * from './types'
export { DEFAULT_RULES } from './rules'
export { ForgottenPartsEngine } from './engine'

import { ForgottenPartsEngine } from './engine'

/** Shared default engine (built-in rule set). */
export const forgottenPartsEngine = new ForgottenPartsEngine()

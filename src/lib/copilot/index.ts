/**
 * GarageFlow AI Copilot (core) — public entry point.
 *
 *   import { handleQuery, classify } from '@/lib/copilot'
 *   const res = handleQuery('Quels devis attendent une réponse ?')
 *
 * Deterministic intent routing over the platform's engines. Impactful actions are
 * ALWAYS returned as confirmation-gated proposals — never executed by the copilot.
 */
export * from './types'
export { classify } from './router'
export { prepareAction } from './actions'
export { handleQuery } from './engine'
export { INTENTS, intentById } from './intents'

/**
 * Intelligent diagnostic assistant — public entry point.
 *
 *   import { diagnose, decodeObdCode } from '@/lib/diagnostic'
 *   const result = diagnose({ symptoms: ['voyant moteur'], obdCodes: ['P0300'], mileage: 180000 })
 *
 * Explainable: probable causes ranked by likelihood, each citing the symptoms /
 * codes / mileage / history behind it, with a recommended check order.
 */
export * from './types'
export { decodeObdCode, OBD_DESCRIPTIONS } from './obd'
export { diagnose } from './engine'
export { CAUSES } from './knowledge'

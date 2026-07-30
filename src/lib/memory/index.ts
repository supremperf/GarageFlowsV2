/**
 * Intelligent garage memory — public entry point.
 *
 *   import { analyzeMemory } from '@/lib/memory'
 *   const { insights } = analyzeMemory(interventionRecords)
 *
 * Derives explainable insights from history: recurring faults, frequent
 * vehicles, part reliability, faster repair methods, low satisfaction.
 */
export * from './types'
export { analyzeMemory } from './analyze'

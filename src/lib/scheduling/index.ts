/**
 * Intelligent scheduling — public entry point.
 *
 *   import { optimizeSchedule } from '@/lib/scheduling'
 *   const plan = optimizeSchedule(jobs, mechanics, { bays: 3 })
 *
 * Deterministic greedy assignment of jobs to (mechanic, bay) pairs that
 * minimizes idle time and balances load, respecting skills, availability and the
 * working day. Produces assignments, unscheduled jobs (with reasons) and metrics.
 */
export * from './types'
export { optimizeSchedule } from './optimize'

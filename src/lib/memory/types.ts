/**
 * Intelligent garage memory — shared types.
 *
 * Every intervention enriches a knowledge base; the engine derives explainable
 * insights from history (recurring faults, part reliability, faster methods,
 * satisfaction). Pure and testable; the API maps Job history into records.
 */

export interface InterventionRecord {
  id: string
  date: string // yyyy-MM-dd
  vehiclePlate?: string | null
  vehicleModel?: string | null
  repairType?: string | null
  mechanicId?: string | null
  mechanicName?: string | null
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  parts?: Array<{ reference?: string | null; name: string }>
  /** Client satisfaction 0..5 (optional — not always captured). */
  satisfaction?: number | null
  /** True if the vehicle came back / the job had to be redone. */
  returned?: boolean
}

export type InsightType =
  | 'recurring_fault'
  | 'frequent_vehicle'
  | 'part_reliability'
  | 'repair_speed'
  | 'low_satisfaction'

export type Severity = 'high' | 'medium' | 'low'
export type Confidence = 'high' | 'medium' | 'low'

export interface MemoryInsight {
  type: InsightType
  severity: Severity
  confidence: Confidence
  title: string
  message: string
  ref?: { plate?: string; repairType?: string; partRef?: string; mechanicName?: string }
  /** Supporting numbers (counts, minutes, rates). */
  metric?: Record<string, number>
}

export interface MemoryResult {
  insights: MemoryInsight[]
  summary: {
    interventions: number
    vehicles: number
    repairTypes: number
  }
}

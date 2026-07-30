/**
 * Intelligent diagnostic assistant — shared types.
 *
 * Given free-text symptoms and/or OBD-II fault codes (plus optional mileage and
 * repair history), it returns probable causes ranked by likelihood, each with a
 * recommended check order, suspected parts, estimated time, difficulty and a
 * confidence level. Explainable: every cause cites what pointed to it.
 */

export type Difficulty = 'easy' | 'medium' | 'hard'
export type Confidence = 'high' | 'medium' | 'low'

export interface DiagnosticInput {
  symptoms?: string[]
  obdCodes?: string[]
  /** Vehicle mileage — boosts wear-related causes when high. */
  mileage?: number
  /** Past repair labels for this vehicle — boosts recurring causes. */
  history?: string[]
}

export interface DecodedObdCode {
  code: string
  valid: boolean
  system: 'powertrain' | 'chassis' | 'body' | 'network' | 'unknown'
  scope: 'generic' | 'manufacturer' | 'unknown'
  subsystem: string | null
  description: string
}

export interface ProbableCause {
  id: string
  name: string
  /** 0..100 probability. */
  probability: number
  confidence: Confidence
  /** Why this cause is proposed (symptoms/codes/mileage/history). */
  justification: string[]
  /** Ordered checks to confirm/rule out. */
  recommendedChecks: string[]
  suspectedParts: string[]
  consumables: string[]
  estimatedTimeMin: number
  difficulty: Difficulty
}

export interface DiagnosticResult {
  causes: ProbableCause[]
  decodedCodes: DecodedObdCode[]
  /** Merged, de-duplicated check order across the top causes. */
  recommendedCheckOrder: string[]
  notes: string[]
}

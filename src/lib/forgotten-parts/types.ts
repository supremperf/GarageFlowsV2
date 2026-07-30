/**
 * Forgotten-parts recommender — shared types.
 *
 * An explainable rules engine: given the operations planned on a job, it surfaces
 * complementary parts/consumables that are commonly required but easy to forget,
 * each with a confidence level, a human justification and an estimated financial
 * impact. Deterministic and auditable — no black box.
 */

export type RecommendationCategory = 'safety' | 'manufacturer' | 'wear' | 'consumable'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** A single recommended complementary part/consumable. */
export interface Recommendation {
  name: string
  reference?: string
  category: RecommendationCategory
  confidence: ConfidenceLevel
  /** 0..1 numeric score behind the confidence level. */
  score: number
  /** Why this is recommended (always present — recommendations must be justified). */
  justification: string
  /** The operation labels that triggered this recommendation. */
  triggeredBy: string[]
  /** Estimated financial impact from the garage catalog when a price is known. */
  estimatedImpact: {
    unitPrice: number | null
    qty: number
    total: number | null
    currency: string
  }
}

/** One catalogued complementary item within a rule. */
export interface RuleRecommendation {
  name: string
  reference?: string
  category: RecommendationCategory
  /** Base confidence 0..1 before contextual boosts. */
  baseConfidence: number
  qty?: number
  reason: string
}

/** A rule: when any keyword matches an operation, emit its recommendations. */
export interface RuleDef {
  id: string
  /** Normalized keywords/keys; a rule fires if any appears in an operation. */
  match: string[]
  recommends: RuleRecommendation[]
}

export interface AnalyzeInput {
  /** Operation labels or repair-type keys planned on the job. */
  operations: string[]
  /** Parts already added to the job (skip re-recommending them). */
  partsOnJob?: Array<{ name?: string | null; reference?: string | null }>
  /** Names/references the garage habitually adds for these operations (boosts confidence). */
  garageHabits?: string[]
  /** reference|name (lowercased) → unit price, for the financial impact. */
  catalog?: Map<string, number>
  currency?: string
}

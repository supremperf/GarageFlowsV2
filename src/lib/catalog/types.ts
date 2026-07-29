/**
 * Parts catalogue (TecDoc-style) — domain types. Framework-free & serialisable.
 *
 * A category hierarchy classifies articles; each article carries fitments
 * (which vehicles it fits) and cross-references (equivalent OE / aftermarket
 * numbers). The engine is deterministic — real catalogue back-ends (a TecDoc
 * API, a supplier feed) plug in behind the `CatalogProvider` interface.
 */

export type CategoryId = string

/** A node in the product-group tree (e.g. « Freinage » › « Plaquettes »). */
export interface Category {
  id: CategoryId
  label: string
  parentId: CategoryId | null
  /** REPAIR_TYPES keys this category relates to (cross-links to interventions). */
  repairTypes?: string[]
}

/** A vehicle a given article fits. An empty fitment list means « universal ». */
export interface Fitment {
  make: string
  /** Model / model family. Matched loosely (normalised contains, either way). */
  model?: string | null
  /** Inclusive production-year range; null = open-ended. */
  yearFrom?: number | null
  yearTo?: number | null
  /** Optional engine code / displacement label. */
  engine?: string | null
}

/** A catalogue article (a specific part from a specific brand). */
export interface CatalogArticle {
  id: string
  /** Primary reference (the brand's article number). */
  reference: string
  brand: string
  name: string
  categoryId: CategoryId
  /** Equivalent references (OE numbers, other brands) for cross-referencing. */
  crossRefs: string[]
  /** Vehicles this article fits; empty = universal. */
  fitments: Fitment[]
  /** Spec attributes, e.g. { « Diamètre »: « 280 mm » }. */
  attributes?: Record<string, string>
  /** Indicative catalogue list price € (not the garage's own cost). */
  listPrice?: number | null
}

/** A vehicle the caller wants compatible parts for. */
export interface VehicleRef {
  make: string
  model?: string | null
  year?: number | null
}

export interface SearchQuery {
  /** Free text matched against name & brand (accent-insensitive). */
  text?: string
  /** A reference to resolve (exact match + cross-reference equivalence). */
  reference?: string
  /** Restrict to a category and (implicitly) its descendants. */
  categoryId?: CategoryId
  /** Restrict to articles fitting this vehicle. */
  vehicle?: VehicleRef
  /** Max results (default 50). */
  limit?: number
}

export type MatchReason = 'reference' | 'crossref' | 'name' | 'brand' | 'category' | 'vehicle'

/** A ranked article with an explanation of why it matched. */
export interface ScoredArticle {
  article: CatalogArticle
  score: number
  matched: MatchReason[]
  /** true/false when a vehicle filter was applied, null when it wasn't. */
  fitsVehicle: boolean | null
}

export interface SearchResult {
  results: ScoredArticle[]
  total: number
  query: SearchQuery
}

/**
 * A catalogue back-end. `search` returns candidate articles (the engine ranks
 * them); `lookupByReference` returns articles carrying a reference (or a
 * cross-reference) equal to the given one. A provider must not throw for a
 * simple "nothing found" — reserve throwing for transport/credential failures.
 */
export interface CatalogProvider {
  readonly id: string
  readonly name: string
  search(query: SearchQuery): Promise<CatalogArticle[]>
  lookupByReference(reference: string): Promise<CatalogArticle[]>
}

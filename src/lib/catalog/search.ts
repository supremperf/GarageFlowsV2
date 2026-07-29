/**
 * Article ranking. Pure & deterministic — the engine feeds it a candidate set
 * plus the resolved category descendants and cross-reference index.
 *
 * Filters (a failing filter excludes the article entirely):
 *   - category: article's category ∈ {categoryId} ∪ descendants
 *   - vehicle:  the article fits the vehicle
 *   - term:     when text/reference is given, the article must match at least one
 *
 * Score (higher = better), fully explainable via `matched`:
 *   exact reference +10 · cross-reference +8 · exact name +6 · name prefix +5 ·
 *   name contains +3 · brand +2 · category +1 · vehicle-fit specificity +0..3
 */
import { normalizeRef, normalizeText } from './normalize'
import type { CrossRefIndex } from './crossref'
import { fitsVehicle, fitmentSpecificity } from './fitment'
import type { CatalogArticle, CategoryId, MatchReason, ScoredArticle, SearchQuery } from './types'

export interface RankContext {
  crossRef: CrossRefIndex
  /** {categoryId} ∪ descendants, or null when no category filter. */
  categoryScope: Set<CategoryId> | null
}

function scoreArticle(article: CatalogArticle, query: SearchQuery, ctx: RankContext): ScoredArticle | null {
  const matched: MatchReason[] = []
  let score = 0

  // ── Category filter ──
  if (ctx.categoryScope) {
    if (!ctx.categoryScope.has(article.categoryId)) return null
    matched.push('category')
    score += 1
  }

  // ── Vehicle filter ──
  let fits: boolean | null = null
  if (query.vehicle) {
    fits = fitsVehicle(article.fitments, query.vehicle)
    if (!fits) return null
    matched.push('vehicle')
    score += fitmentSpecificity(article.fitments, query.vehicle)
  }

  // ── Reference term ──
  let termMatched = false
  if (query.reference && normalizeRef(query.reference)) {
    const nq = normalizeRef(query.reference)
    if (normalizeRef(article.reference) === nq) {
      score += 10
      matched.push('reference')
      termMatched = true
    } else if (
      article.crossRefs.some((r) => normalizeRef(r) === nq) ||
      ctx.crossRef.areEquivalent(article.reference, query.reference)
    ) {
      score += 8
      matched.push('crossref')
      termMatched = true
    }
  }

  // ── Text term ──
  if (query.text && normalizeText(query.text)) {
    const t = normalizeText(query.text)
    const tokens = t.split(' ').filter(Boolean)
    const name = normalizeText(article.name)
    const brand = normalizeText(article.brand)
    if (tokens.every((tok) => name.includes(tok))) {
      score += name === t ? 6 : name.startsWith(t) ? 5 : 3
      matched.push('name')
      termMatched = true
    } else if (tokens.every((tok) => brand.includes(tok))) {
      score += 2
      matched.push('brand')
      termMatched = true
    }
  }

  // When a search term was supplied, the article must actually match it.
  const hasTerm = !!(query.text?.trim() || query.reference?.trim())
  if (hasTerm && !termMatched) return null

  return { article, score, matched, fitsVehicle: fits }
}

/** Rank a candidate set against the query. */
export function rankArticles(articles: CatalogArticle[], query: SearchQuery, ctx: RankContext): ScoredArticle[] {
  const scored: ScoredArticle[] = []
  for (const a of articles) {
    const s = scoreArticle(a, query, ctx)
    if (s) scored.push(s)
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const n = normalizeText(a.article.name).localeCompare(normalizeText(b.article.name))
    if (n !== 0) return n
    return a.article.reference.localeCompare(b.article.reference)
  })
  return scored
}

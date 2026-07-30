/**
 * Catalogue providers — the pluggable boundary to real catalogue back-ends.
 * The offline `StaticCatalogProvider` serves an in-memory dataset so the engine
 * is fully testable; a TecDoc-style API implements the same interface.
 */
import { normalizeRef, normalizeText } from './normalize'
import { fitsVehicle } from './fitment'
import type { CatalogArticle, CatalogProvider, SearchQuery } from './types'

/**
 * A provider backed by an in-memory article list. `search` does a cheap
 * pre-filter (the engine re-ranks precisely); `lookupByReference` returns every
 * article carrying the reference as its primary or a cross-reference.
 */
export class StaticCatalogProvider implements CatalogProvider {
  readonly id: string
  readonly name: string
  private readonly articles: CatalogArticle[]

  constructor(articles: CatalogArticle[], id = 'static', name = 'Catalogue interne') {
    this.articles = articles
    this.id = id
    this.name = name
  }

  async search(query: SearchQuery): Promise<CatalogArticle[]> {
    const hasText = !!query.text?.trim()
    const hasRef = !!query.reference?.trim()
    const t = normalizeText(query.text)
    const tokens = t.split(' ').filter(Boolean)
    const nq = normalizeRef(query.reference)

    // Category *scope* (a parent selects its descendants) is applied by the
    // engine, so the pre-filter never drops on category — only on vehicle fit
    // and the search term.
    return this.articles.filter((a) => {
      if (query.vehicle && !fitsVehicle(a.fitments, query.vehicle)) return false
      if (hasRef) {
        if (normalizeRef(a.reference) === nq || a.crossRefs.some((r) => normalizeRef(r) === nq)) return true
        if (!hasText) return false
      }
      if (hasText) {
        const hay = `${normalizeText(a.name)} ${normalizeText(a.brand)}`
        if (tokens.every((tok) => hay.includes(tok))) return true
        if (!hasRef) return false
      }
      // No text/ref term → keep (vehicle/category handled by engine).
      return !hasText && !hasRef
    })
  }

  async lookupByReference(reference: string): Promise<CatalogArticle[]> {
    const nq = normalizeRef(reference)
    if (!nq) return []
    return this.articles.filter(
      (a) => normalizeRef(a.reference) === nq || a.crossRefs.some((r) => normalizeRef(r) === nq),
    )
  }
}

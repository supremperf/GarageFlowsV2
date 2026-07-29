/**
 * Catalogue engine — orchestrates providers → merge → cross-ref → rank.
 *
 * Registers any number of `CatalogProvider`s, fans queries out concurrently,
 * merges & de-duplicates the articles (by id, first provider wins), builds a
 * cross-reference index over the merged set and ranks the result. A provider
 * that throws is isolated; its error is reported and the run continues.
 */
import { buildCrossRefIndex } from './crossref'
import { categoryScope, categoryPath } from './categories'
import { rankArticles } from './search'
import type {
  CatalogArticle,
  CatalogProvider,
  Category,
  CategoryId,
  SearchQuery,
  SearchResult,
  VehicleRef,
} from './types'

export interface CatalogRun extends SearchResult {
  errors: { providerId: string; providerName: string; error: string }[]
}

export interface EquivalentsRun {
  reference: string
  equivalents: string[]
  articles: CatalogArticle[]
  errors: { providerId: string; providerName: string; error: string }[]
}

const MAX_LIMIT = 200

export class CatalogEngine {
  private readonly providers = new Map<string, CatalogProvider>()
  private readonly categories: Category[]

  constructor(providers: CatalogProvider[] = [], categories: Category[] = []) {
    for (const p of providers) this.register(p)
    this.categories = categories
  }

  register(provider: CatalogProvider): this {
    this.providers.set(provider.id, provider)
    return this
  }

  list(): CatalogProvider[] {
    return Array.from(this.providers.values())
  }

  getCategories(): Category[] {
    return this.categories
  }

  categoryPath(id: CategoryId): Category[] {
    return categoryPath(this.categories, id)
  }

  private mergeArticles(lists: CatalogArticle[][]): CatalogArticle[] {
    const byId = new Map<string, CatalogArticle>()
    for (const list of lists) {
      for (const a of list) if (!byId.has(a.id)) byId.set(a.id, a)
    }
    return Array.from(byId.values())
  }

  private async fanOut<T>(
    fn: (p: CatalogProvider) => Promise<T[]>,
  ): Promise<{ lists: T[][]; errors: CatalogRun['errors'] }> {
    const providers = this.list()
    const settled = await Promise.allSettled(providers.map(fn))
    const lists: T[][] = []
    const errors: CatalogRun['errors'] = []
    settled.forEach((res, i) => {
      const p = providers[i]
      if (res.status === 'fulfilled') lists.push(res.value)
      else errors.push({ providerId: p.id, providerName: p.name, error: res.reason instanceof Error ? res.reason.message : String(res.reason) })
    })
    return { lists, errors }
  }

  /** Search all providers, then rank the merged & de-duplicated candidates. */
  async search(query: SearchQuery): Promise<CatalogRun> {
    const { lists, errors } = await this.fanOut((p) => p.search(query))
    const merged = this.mergeArticles(lists)
    const crossRef = buildCrossRefIndex(merged)
    const scope = query.categoryId ? categoryScope(this.categories, query.categoryId) : null
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? 50))

    const ranked = rankArticles(merged, query, { crossRef, categoryScope: scope })
    return { results: ranked.slice(0, limit), total: ranked.length, query, errors }
  }

  /** Compatible parts for a vehicle, optionally within a category. */
  async compatible(vehicle: VehicleRef, opts: { categoryId?: CategoryId; limit?: number } = {}): Promise<CatalogRun> {
    return this.search({ vehicle, categoryId: opts.categoryId, limit: opts.limit })
  }

  /** Resolve a reference to its full cross-reference equivalence class. */
  async equivalents(reference: string): Promise<EquivalentsRun> {
    const { lists, errors } = await this.fanOut((p) => p.lookupByReference(reference))
    const articles = this.mergeArticles(lists)
    const crossRef = buildCrossRefIndex(articles)
    crossRef.add(reference)
    return { reference, equivalents: crossRef.equivalents(reference), articles, errors }
  }
}

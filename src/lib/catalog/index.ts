/**
 * Parts catalogue (TecDoc-style) — public entry point.
 *
 *   import { CatalogEngine, StaticCatalogProvider, SEED_ARTICLES, SEED_CATEGORIES } from '@/lib/catalog'
 *
 *   const engine = new CatalogEngine([new StaticCatalogProvider(SEED_ARTICLES)], SEED_CATEGORIES)
 *   const { results } = await engine.search({ text: 'plaquettes', vehicle: { make: 'Peugeot', model: '308', year: 2010 } })
 *   const equiv = await engine.equivalents('0986494600')   // OE ↔ aftermarket
 *
 * The core is deterministic & offline-testable; real catalogue back-ends plug in
 * behind the `CatalogProvider` interface.
 */
export * from './types'
export { normalizeText, normalizeRef } from './normalize'
export { CrossRefIndex, buildCrossRefIndex } from './crossref'
export { fitmentMatches, fitsVehicle, fitmentSpecificity } from './fitment'
export { categoryScope, categoryPath, categoriesForRepairType } from './categories'
export { rankArticles } from './search'
export type { RankContext } from './search'
export { StaticCatalogProvider } from './providers'
export { CatalogEngine } from './engine'
export type { CatalogRun, EquivalentsRun } from './engine'
export { SEED_CATEGORIES, SEED_ARTICLES } from './seed'

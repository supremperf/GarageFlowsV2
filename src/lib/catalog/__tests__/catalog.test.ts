import { describe, it, expect } from 'vitest'
import {
  CatalogEngine,
  StaticCatalogProvider,
  CrossRefIndex,
  buildCrossRefIndex,
  fitsVehicle,
  fitmentSpecificity,
  categoryScope,
  categoryPath,
  categoriesForRepairType,
  normalizeRef,
  SEED_ARTICLES,
  SEED_CATEGORIES,
  type CatalogArticle,
  type CatalogProvider,
} from '../index'

const engine = () => new CatalogEngine([new StaticCatalogProvider(SEED_ARTICLES)], SEED_CATEGORIES)

describe('normalizeRef', () => {
  it('collapses spacing/case/punctuation to a canonical key', () => {
    expect(normalizeRef('brk-100')).toBe('BRK100')
    expect(normalizeRef(' BRK.100 ')).toBe('BRK100')
    expect(normalizeRef('09.9464.11')).toBe('09946411')
    expect(normalizeRef(null)).toBe('')
  })
})

describe('CrossRefIndex', () => {
  it('unions references transitively across articles', () => {
    // FDB1330 ↔ 0986494600 (Ferodo lists Bosch as equiv); Bosch ↔ 425371.
    const idx = buildCrossRefIndex(SEED_ARTICLES)
    expect(idx.areEquivalent('FDB1330', '425371')).toBe(true)
    expect(idx.areEquivalent('0986494600', 'GDB1330')).toBe(true)
    expect(idx.areEquivalent('FDB1330', 'GDB1789')).toBe(false) // different vehicle
  })

  it('returns the full equivalence class, sorted, including an unseen ref', () => {
    const idx = buildCrossRefIndex(SEED_ARTICLES)
    const eq = idx.equivalents('0986494600')
    expect(eq).toContain('425371')
    expect(eq).toContain('FDB1330')
    expect(idx.equivalents('UNKNOWN-REF')).toEqual(['UNKNOWN-REF'])
  })

  it('treats identical unseen refs as equivalent and empty as not', () => {
    const idx = new CrossRefIndex()
    expect(idx.areEquivalent('X1', 'x-1')).toBe(true)
    expect(idx.areEquivalent('', 'x')).toBe(false)
  })
})

describe('fitment', () => {
  const pads = SEED_ARTICLES.find((a) => a.id === 'a-bosch-bp308')!
  const oil = SEED_ARTICLES.find((a) => a.id === 'a-total-5w30')!

  it('matches make/model/year within range (accent- & case-insensitive)', () => {
    expect(fitsVehicle(pads.fitments, { make: 'peugeot', model: '308', year: 2010 })).toBe(true)
    expect(fitsVehicle(pads.fitments, { make: 'Peugeot', model: '308', year: 2020 })).toBe(false) // out of range
    expect(fitsVehicle(pads.fitments, { make: 'Renault', model: 'Clio', year: 2015 })).toBe(false)
  })

  it('treats an empty fitment list as universal', () => {
    expect(fitsVehicle(oil.fitments, { make: 'Toyota', model: 'Yaris', year: 2022 })).toBe(true)
    expect(fitmentSpecificity(oil.fitments, { make: 'Toyota' })).toBe(0)
  })

  it('never disqualifies on a missing year', () => {
    expect(fitsVehicle(pads.fitments, { make: 'Peugeot', model: '308' })).toBe(true)
  })

  it('scores a make+model+year fit above a make-only fit', () => {
    const battery = SEED_ARTICLES.find((a) => a.id === 'a-varta-e11')!
    expect(fitmentSpecificity(battery.fitments, { make: 'Peugeot', model: '308', year: 2010 })).toBe(2) // no year range on fitment
    expect(fitmentSpecificity(pads.fitments, { make: 'Peugeot', model: '308', year: 2010 })).toBe(3)
  })
})

describe('categories', () => {
  it('resolves a scope of a category plus descendants', () => {
    const scope = categoryScope(SEED_CATEGORIES, 'braking')
    expect(scope.has('braking')).toBe(true)
    expect(scope.has('brake_pads')).toBe(true)
    expect(scope.has('brake_discs')).toBe(true)
    expect(scope.has('oil')).toBe(false)
  })

  it('builds a root→node path and maps repair types', () => {
    expect(categoryPath(SEED_CATEGORIES, 'brake_pads').map((c) => c.id)).toEqual(['braking', 'brake_pads'])
    expect(categoriesForRepairType(SEED_CATEGORIES, 'brake_discs').map((c) => c.id)).toContain('brake_discs')
  })
})

describe('CatalogEngine.search', () => {
  it('ranks an exact reference above a text match', async () => {
    const { results } = await engine().search({ reference: '0986494600' })
    expect(results[0].article.id).toBe('a-bosch-bp308')
    expect(results[0].matched).toContain('reference')
  })

  it('finds articles by an OE cross-reference number', async () => {
    const { results } = await engine().search({ reference: '425371' })
    const ids = results.map((r) => r.article.id)
    // 425371 is a cross-ref shared by the Bosch and Ferodo front pads.
    expect(ids).toContain('a-bosch-bp308')
    expect(ids).toContain('a-ferodo-bp308')
    expect(results.every((r) => r.matched.includes('reference') || r.matched.includes('crossref'))).toBe(true)
  })

  it('filters by vehicle and category scope together', async () => {
    const { results } = await engine().search({ vehicle: { make: 'Peugeot', model: '308', year: 2010 }, categoryId: 'braking' })
    const ids = results.map((r) => r.article.id).sort()
    expect(ids).toEqual(['a-bosch-bp308', 'a-brembo-bd308', 'a-ferodo-bp308'])
    expect(results.every((r) => r.fitsVehicle === true)).toBe(true)
  })

  it('excludes articles that do not fit the vehicle', async () => {
    const { results } = await engine().search({ text: 'filtre', vehicle: { make: 'Volkswagen', model: 'Golf', year: 2015 } })
    const ids = results.map((r) => r.article.id)
    expect(ids).toContain('a-bosch-p3274') // Golf oil filter
    expect(ids).not.toContain('a-mann-c30') // 308-only air filter
  })

  it('matches free text on name accent-insensitively and respects the limit', async () => {
    const { results, total } = await engine().search({ text: 'plaquettes', limit: 2 })
    expect(results.length).toBe(2)
    expect(total).toBeGreaterThanOrEqual(3)
    expect(results.every((r) => r.matched.includes('name'))).toBe(true)
  })

  it('returns nothing for a term that matches no article', async () => {
    const { results } = await engine().search({ text: 'turbocompresseur' })
    expect(results).toHaveLength(0)
  })
})

describe('CatalogEngine.equivalents & compatible', () => {
  it('returns the cross-reference class for a reference', async () => {
    const { equivalents, articles } = await engine().equivalents('W71280')
    expect(equivalents).toContain('OC90')
    expect(equivalents).toContain('F026407274')
    expect(articles.map((a) => a.id)).toContain('a-mann-w712')
  })

  it('lists compatible parts for a vehicle', async () => {
    const { results } = await engine().compatible({ make: 'Renault', model: 'Clio', year: 2015 })
    const ids = results.map((r) => r.article.id)
    expect(ids).toContain('a-trw-bpclio')
    expect(ids).toContain('a-ngk-plug')
    expect(ids).not.toContain('a-brembo-bd308') // 308 disc
  })
})

describe('CatalogEngine resilience', () => {
  it('isolates a throwing provider and still serves the rest', async () => {
    const broken: CatalogProvider = {
      id: 'broken', name: 'Broken',
      search: async () => { throw new Error('catalogue down') },
      lookupByReference: async () => { throw new Error('catalogue down') },
    }
    const e = new CatalogEngine([broken, new StaticCatalogProvider(SEED_ARTICLES)], SEED_CATEGORIES)
    const { results, errors } = await e.search({ text: 'batterie' })
    expect(errors).toEqual([{ providerId: 'broken', providerName: 'Broken', error: 'catalogue down' }])
    expect(results.map((r) => r.article.id)).toContain('a-varta-e11')
  })

  it('de-duplicates the same article id served by two providers', async () => {
    const dup: CatalogArticle = SEED_ARTICLES[0]
    const e = new CatalogEngine([new StaticCatalogProvider([dup]), new StaticCatalogProvider([dup])], SEED_CATEGORIES)
    const { results } = await e.search({ reference: dup.reference })
    expect(results.filter((r) => r.article.id === dup.id)).toHaveLength(1)
  })
})

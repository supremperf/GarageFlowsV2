import { describe, it, expect } from 'vitest'
import {
  SupplierEngine,
  StaticConnector,
  FallbackConnector,
  rankLine,
  buildOrderPlan,
  transition,
  canTransition,
  isTerminal,
  type PartQuery,
  type SupplierConnector,
  type SupplierOffer,
} from '../index'

const queries: PartQuery[] = [
  { partId: 'p1', name: 'Plaquettes avant', reference: 'BRK-100', quantity: 4 },
  { partId: 'p2', name: 'Filtre à huile', reference: 'OIL-9', quantity: 2 },
]

const cheap = new StaticConnector({
  id: 'cheap', name: 'DiscountParts', favorite: false,
  catalog: [
    { reference: 'BRK-100', supplierRef: 'DP-B1', unitPrice: 20, availableQty: 10, leadTimeDays: 5 },
    { reference: 'OIL-9', supplierRef: 'DP-O9', unitPrice: 8, availableQty: 1, leadTimeDays: 3 },
  ],
})

const favorite = new StaticConnector({
  id: 'fav', name: 'AtelierPro', favorite: true,
  catalog: [
    { reference: 'BRK-100', supplierRef: 'AP-B1', unitPrice: 21, availableQty: 10, leadTimeDays: 2 },
    { reference: 'OIL-9', supplierRef: 'AP-O9', unitPrice: 9, availableQty: 5, leadTimeDays: 2 },
  ],
})

describe('StaticConnector', () => {
  it('quotes matching references and skips out-of-stock / unknown parts', async () => {
    const offers = await cheap.quote([
      ...queries,
      { partId: 'p3', name: 'Inconnu', reference: 'NOPE', quantity: 1 },
    ])
    expect(offers.map((o) => o.partId).sort()).toEqual(['p1', 'p2'])
    const brk = offers.find((o) => o.partId === 'p1')!
    expect(brk.unitPrice).toBe(20)
    expect(brk.requestedQty).toBe(4)
    expect(brk.availableQty).toBe(10)
  })

  it('matches accent-insensitively by name when no reference is given', async () => {
    const conn = new StaticConnector({
      id: 's', name: 'S', catalog: [{ name: 'Filtre à Huile', unitPrice: 7, availableQty: 3, leadTimeDays: 1 }],
    })
    const offers = await conn.quote([{ partId: 'x', name: 'filtre a huile', quantity: 1 }])
    expect(offers).toHaveLength(1)
    expect(offers[0].unitPrice).toBe(7)
  })
})

describe('rankLine', () => {
  const offers: SupplierOffer[] = [
    { supplierId: 'cheap', supplierName: 'DiscountParts', partId: 'p1', unitPrice: 20, availableQty: 10, requestedQty: 4, leadTimeDays: 5, favorite: false },
    { supplierId: 'fav', supplierName: 'AtelierPro', partId: 'p1', unitPrice: 21, availableQty: 10, requestedQty: 4, leadTimeDays: 2, favorite: true },
  ]

  it('prefers a favourite within the price tolerance band', () => {
    const cmp = rankLine(queries[0], offers) // 21 vs 20 → within default 5%
    expect(cmp.best?.supplierId).toBe('fav')
    expect(cmp.rankings[0].selected).toBe(true)
  })

  it('picks the cheaper supplier once outside the tolerance band', () => {
    const pricier = offers.map((o) => (o.supplierId === 'fav' ? { ...o, unitPrice: 30 } : o))
    const cmp = rankLine(queries[0], pricier)
    expect(cmp.best?.supplierId).toBe('cheap')
  })

  it('ranks a full-cover offer above a cheaper partial one', () => {
    const partial: SupplierOffer[] = [
      { supplierId: 'a', supplierName: 'A', partId: 'p1', unitPrice: 10, availableQty: 2, requestedQty: 4, leadTimeDays: 1, favorite: false },
      { supplierId: 'b', supplierName: 'B', partId: 'p1', unitPrice: 15, availableQty: 4, requestedQty: 4, leadTimeDays: 1, favorite: false },
    ]
    const cmp = rankLine(queries[0], partial)
    expect(cmp.best?.supplierId).toBe('b')
    expect(cmp.shortfall).toBe(false)
  })

  it('flags a shortfall when nobody covers the quantity', () => {
    const short: SupplierOffer[] = [
      { supplierId: 'a', supplierName: 'A', partId: 'p1', unitPrice: 10, availableQty: 1, requestedQty: 4, leadTimeDays: 1, favorite: false },
    ]
    const cmp = rankLine(queries[0], short)
    expect(cmp.shortfall).toBe(true)
    expect(cmp.best?.supplierId).toBe('a')
  })

  it('returns no best offer when there are no offers', () => {
    const cmp = rankLine(queries[0], [])
    expect(cmp.best).toBeNull()
    expect(cmp.shortfall).toBe(true)
  })
})

describe('buildOrderPlan', () => {
  it('groups winning offers into one order per supplier and caps qty to stock', async () => {
    const engine = new SupplierEngine([cheap, favorite])
    const { plan } = await engine.quote(queries)

    // p1 → favourite (21 within tolerance, faster); p2 → cheap has only 1 in stock,
    // favourite has 5 → full-cover favourite wins.
    const bySupplier = Object.fromEntries(plan.orders.map((o) => [o.supplierId, o]))
    expect(bySupplier['fav']).toBeDefined()
    const fav = bySupplier['fav']
    // both lines resolve to the favourite here
    expect(fav.lines.map((l) => l.partId).sort()).toEqual(['p1', 'p2'])
    expect(fav.totalHT).toBe(4 * 21 + 2 * 9)
    expect(fav.maxLeadTimeDays).toBe(2)
    expect(plan.summary.parts).toBe(2)
    expect(plan.summary.unfulfillable).toBe(0)
  })

  it('reports unfulfillable lines separately', () => {
    const plan = buildOrderPlan(
      [{ partId: 'z', name: 'Rare', reference: 'RARE', quantity: 1 }],
      [],
    )
    expect(plan.orders).toHaveLength(0)
    expect(plan.unfulfillable).toEqual([{ partId: 'z', name: 'Rare', requestedQty: 1 }])
    expect(plan.summary.unfulfillable).toBe(1)
  })

  it('caps the ordered quantity to available stock on a partial best offer', () => {
    const offers: SupplierOffer[] = [
      { supplierId: 'a', supplierName: 'A', partId: 'p1', unitPrice: 10, availableQty: 3, requestedQty: 4, leadTimeDays: 1, favorite: false },
    ]
    const plan = buildOrderPlan([queries[0]], offers)
    expect(plan.orders[0].lines[0].quantity).toBe(3)
    expect(plan.orders[0].lines[0].lineTotal).toBe(30)
  })
})

describe('SupplierEngine resilience', () => {
  it('isolates a throwing connector and continues with the rest', async () => {
    const broken: SupplierConnector = {
      id: 'broken', name: 'Broken', favorite: false,
      quote: async () => { throw new Error('API down') },
    }
    const engine = new SupplierEngine([broken, cheap])
    const { plan, errors } = await engine.quote(queries)
    expect(errors).toEqual([{ supplierId: 'broken', supplierName: 'Broken', error: 'API down' }])
    expect(plan.orders.length).toBeGreaterThan(0)
  })

  it('uses the fallback connector when a part is not in any catalogue', async () => {
    const engine = new SupplierEngine([
      new StaticConnector({ id: 's', name: 'S', catalog: [] }),
      new FallbackConnector('fb', 'Grossiste', { unitPrice: 99, leadTimeDays: 10 }),
    ])
    const { plan } = await engine.quote([{ partId: 'p', name: 'X', quantity: 1 }])
    expect(plan.orders).toHaveLength(1)
    expect(plan.orders[0].supplierId).toBe('fb')
    expect(plan.orders[0].lines[0].unitPrice).toBe(99)
  })

  it('ignores invalid queries (missing id or non-positive quantity)', async () => {
    const engine = new SupplierEngine([cheap])
    const { plan } = await engine.quote([
      { partId: '', name: 'bad', quantity: 4 },
      { partId: 'p1', name: 'Plaquettes', reference: 'BRK-100', quantity: 0 },
    ])
    expect(plan.summary.parts).toBe(0)
    expect(plan.orders).toHaveLength(0)
  })
})

describe('order lifecycle', () => {
  it('allows the happy path draft → sent → confirmed → received', () => {
    expect(transition('draft', 'sent').ok).toBe(true)
    expect(transition('sent', 'confirmed').ok).toBe(true)
    const recv = transition('confirmed', 'received')
    expect(recv.ok).toBe(true)
    expect(recv.effects.incrementStock).toBe(true)
    expect(recv.effects.stampReceived).toBe(true)
  })

  it('stamps sent and marks the send transition', () => {
    const sent = transition('draft', 'sent')
    expect(sent.effects.stampSent).toBe(true)
    expect(sent.effects.incrementStock).toBe(false)
  })

  it('rejects illegal and no-op transitions', () => {
    expect(canTransition('draft', 'received')).toBe(false)
    expect(transition('draft', 'received').ok).toBe(false)
    expect(transition('received', 'sent').ok).toBe(false)
    expect(transition('sent', 'sent').ok).toBe(false)
  })

  it('treats cancelled and returned as terminal', () => {
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('returned')).toBe(true)
    expect(transition('cancelled', 'sent').ok).toBe(false)
    const ret = transition('received', 'returned')
    expect(ret.ok).toBe(true)
    expect(ret.terminal).toBe(true)
    expect(ret.effects.decrementStock).toBe(true)
  })
})

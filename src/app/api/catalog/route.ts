export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import {
  CatalogEngine,
  StaticCatalogProvider,
  normalizeRef,
  SEED_ARTICLES,
  SEED_CATEGORIES,
  type ScoredArticle,
  type VehicleRef,
} from '@/lib/catalog'
import { vinEngine } from '@/lib/vin'

function buildEngine(): CatalogEngine {
  return new CatalogEngine([new StaticCatalogProvider(SEED_ARTICLES)], SEED_CATEGORIES)
}

/** Resolve the target vehicle from explicit params, a stored plate, or a VIN. */
async function resolveVehicle(
  garageId: string,
  params: URLSearchParams,
): Promise<VehicleRef | undefined> {
  const make = params.get('make')?.trim()
  const model = params.get('model')?.trim() || null
  const yearRaw = params.get('year')
  // Parse the year once, guarded — a non-numeric param must never reach the
  // ranking engine as NaN (NaN != null skews fitment specificity).
  const parsedYear = yearRaw != null && yearRaw !== '' ? Number(yearRaw) : NaN
  const year = Number.isFinite(parsedYear) ? parsedYear : null

  if (make) return { make, model, year }

  const plate = params.get('plate')?.trim()
  if (plate) {
    const v = await prisma.vehicle.findFirst({
      where: { garageId, licensePlate: plate },
      select: { make: true, model: true, year: true },
    })
    if (v) return { make: v.make, model: v.model, year: v.year ?? null }
  }

  const vin = params.get('vin')?.trim()
  if (vin) {
    const decoded = await vinEngine.decode(vin).catch(() => null)
    if (decoded?.manufacturer) return { make: decoded.manufacturer, model, year: decoded.modelYear ?? year }
  }

  return undefined
}

/**
 * Map each garage part reference (normalised) → total quantity on hand.
 * Aggregated in the database (groupBy) so it is correct regardless of how many
 * parts a garage holds — no row cap, no ordering dependence.
 */
async function stockByRef(garageId: string): Promise<Map<string, number>> {
  const grouped = await prisma.part.groupBy({
    by: ['reference'],
    where: { garageId, reference: { not: null } },
    _sum: { quantity: true },
  })
  const map = new Map<string, number>()
  for (const g of grouped) {
    const key = normalizeRef(g.reference)
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + (g._sum.quantity ?? 0))
  }
  return map
}

function annotateStock(results: ScoredArticle[], stock: Map<string, number>) {
  return results.map((r) => {
    const keys = [r.article.reference, ...r.article.crossRefs].map(normalizeRef).filter(Boolean)
    let qty = 0
    let hit = false
    for (const k of keys) {
      const q = stock.get(k)
      if (q != null) { hit = true; qty += q }
    }
    return { ...r, inStock: hit, stockQuantity: hit ? qty : 0 }
  })
}

// GET /api/catalog
//   ?text=&reference=&categoryId=&make=&model=&year=&plate=&vin=&limit=
//   ?action=categories                 → the category tree
//   ?action=equivalents&reference=XXX  → the cross-reference equivalence class
// Read-only: no writes, so no confirmation required.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const engine = buildEngine()

  if (action === 'categories') {
    return NextResponse.json({ categories: engine.getCategories() })
  }

  if (action === 'equivalents') {
    const reference = searchParams.get('reference')?.trim()
    if (!reference) return NextResponse.json({ error: 'reference requise' }, { status: 400 })
    const run = await engine.equivalents(reference)
    const stock = await stockByRef(garageId)
    const inStock = run.equivalents.some((r) => stock.has(normalizeRef(r)))
    return NextResponse.json({ ...run, inStock })
  }

  const vehicle = await resolveVehicle(garageId, searchParams)
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50

  const run = await engine.search({
    text: searchParams.get('text')?.trim() || undefined,
    reference: searchParams.get('reference')?.trim() || undefined,
    categoryId: searchParams.get('categoryId')?.trim() || undefined,
    vehicle,
    limit,
  })

  const stock = await stockByRef(garageId)
  const results = annotateStock(run.results, stock).map((r) => ({
    ...r,
    categoryPath: engine.categoryPath(r.article.categoryId).map((c) => ({ id: c.id, label: c.label })),
  }))

  return NextResponse.json({ results, total: run.total, vehicle: vehicle ?? null, errors: run.errors })
})

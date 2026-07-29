/**
 * API-route integration test for GET /api/catalog.
 *
 * Real handler over a temporary SQLite DB, auth mocked. Verifies ranked search
 * through the route, transitive cross-references, plate resolution scoped per
 * garage, and the in-stock annotation aggregated from the garage's own parts.
 * Read-only: seed once, only the session changes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-catalog.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

/* eslint-disable @typescript-eslint/no-explicit-any */
let GET: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string

async function get(qs: string): Promise<{ status: number; json: any }> {
  const res = await GET(new Request(`http://localhost/api/catalog${qs}`))
  return { status: res.status, json: await res.json() }
}
const asA = () => { h.session = { user: { id: 'ua', name: 'A', garageId: garageA } } }
const asB = () => { h.session = { user: { id: 'ub', name: 'B', garageId: garageB } } }
const ids = (json: any) => json.results.map((r: any) => r.article.id)

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore' })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = await import('@/app/api/catalog/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
  const clientA = (await prisma.client.create({ data: { name: 'CA', garageId: garageA } })).id
  const clientB = (await prisma.client.create({ data: { name: 'CB', garageId: garageB } })).id
  // Same plate in both garages (allowed by @@unique([licensePlate,garageId])).
  await prisma.vehicle.create({ data: { licensePlate: 'AB-123-CD', make: 'Peugeot', model: '308', year: 2010, clientId: clientA, garageId: garageA } })
  await prisma.vehicle.create({ data: { licensePlate: 'AB-123-CD', make: 'Renault', model: 'Clio', year: 2015, clientId: clientB, garageId: garageB } })
  // Two differently-spelled refs that normalise to the same key → aggregate to 5.
  await prisma.part.create({ data: { name: 'Plaquettes avant', reference: '0986494600', quantity: 7, garageId: garageA } })
  await prisma.part.create({ data: { name: 'Filtre huile', reference: 'W71280', quantity: 2, garageId: garageA } })
  await prisma.part.create({ data: { name: 'Filtre huile lot2', reference: 'W712 80', quantity: 3, garageId: garageA } })
  await prisma.part.create({ data: { name: 'Divers', reference: null, quantity: 50, garageId: garageA } })
  await prisma.part.create({ data: { name: 'Plaquettes Clio', reference: 'GDB1789', quantity: 99, garageId: garageB } })
  asA()
})

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

describe('GET /api/catalog', () => {
  it('returns ranked text-search results from the seed catalogue', async () => {
    const { status, json } = await get('?text=plaquettes')
    expect(status).toBe(200)
    expect(ids(json)).toEqual(expect.arrayContaining(['a-bosch-bp308', 'a-ferodo-bp308', 'a-trw-bpclio']))
    expect(json.total).toBe(3)
    expect(json.errors).toEqual([])
  })

  it('ranks an exact reference first and surfaces a transitive cross-reference', async () => {
    const exact = await get('?reference=0986494600')
    expect(exact.json.results[0].article.id).toBe('a-bosch-bp308')
    expect(exact.json.results[0].matched).toContain('reference')
    // GDB1330 is carried only by Bosch; Ferodo is reached transitively via OE 425371.
    const transitive = await get('?reference=GDB1330')
    expect(ids(transitive.json)).toEqual(expect.arrayContaining(['a-bosch-bp308', 'a-ferodo-bp308']))
  })

  it('annotates inStock/stockQuantity, aggregating refs that normalise equal', async () => {
    const { json } = await get('?reference=W71280')
    const mann = json.results.find((r: any) => r.article.id === 'a-mann-w712')
    expect(mann.inStock).toBe(true)
    expect(mann.stockQuantity).toBe(5) // W71280 (2) + "W712 80" (3), null-ref part ignored
  })

  it('resolves the vehicle from a stored plate, scoped per garage', async () => {
    asA()
    const a = await get('?plate=AB-123-CD&categoryId=braking')
    expect(a.json.vehicle).toMatchObject({ make: 'Peugeot', model: '308', year: 2010 })
    expect(ids(a.json)).toEqual(expect.arrayContaining(['a-bosch-bp308', 'a-brembo-bd308']))
    expect(a.json.results.every((r: any) => r.fitsVehicle === true)).toBe(true)

    asB() // same plate string, different tenant → different vehicle
    const b = await get('?plate=AB-123-CD&categoryId=braking')
    expect(b.json.vehicle).toMatchObject({ make: 'Renault', model: 'Clio', year: 2015 })
    expect(ids(b.json)).toEqual(['a-trw-bpclio'])
    asA()
  })

  it('guards a non-numeric year param to null (never NaN)', async () => {
    const { json } = await get('?make=Peugeot&model=308&year=abc')
    expect(json.vehicle).toEqual({ make: 'Peugeot', model: '308', year: null })
  })

  it('scopes the in-stock join per garage', async () => {
    asB()
    const { json } = await get('?categoryId=brake_pads')
    const trw = json.results.find((r: any) => r.article.id === 'a-trw-bpclio')
    const bosch = json.results.find((r: any) => r.article.id === 'a-bosch-bp308')
    expect(trw.inStock).toBe(true) // B stocks GDB1789
    expect(bosch.inStock).toBe(false) // A's 0986494600 stock does not leak into B
    asA()
  })

  it('returns the cross-reference equivalence class (action=equivalents)', async () => {
    const { json } = await get('?action=equivalents&reference=0986494600')
    expect(json.reference).toBe('0986494600')
    expect(json.equivalents).toEqual(expect.arrayContaining(['425371', 'FDB1330', 'GDB1330']))
    expect(json.inStock).toBe(true) // garage A stocks 0986494600
  })

  it('400s on equivalents with no reference, and serves the category tree', async () => {
    expect((await get('?action=equivalents')).status).toBe(400)
    const cats = await get('?action=categories')
    expect(cats.status).toBe(200)
    expect(cats.json.categories.length).toBe(14)
    expect(cats.json.categories.map((c: any) => c.id)).toEqual(expect.arrayContaining(['braking', 'brake_pads', 'brake_discs']))
  })
})

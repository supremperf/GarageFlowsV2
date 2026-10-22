/**
 * Supplier metadata is editable through the product, but it is not a live
 * supplier integration and must never be treated as a current quote or proof
 * of availability. This test verifies the CRUD path and the production route's
 * fail-closed response while no real supplier adapter is configured.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-supplier-linkage.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let partsPOST: (req: Request) => Promise<Response>
let partPATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let suppliersGET: (req: Request) => Promise<Response>
let prisma: any
let garageA: string

const creerPiece = async (corps: unknown) =>
  partsPOST(new Request('http://localhost/api/parts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  }))

const modifierPiece = async (id: string, corps: unknown) =>
  partPATCH(
    new Request(`http://localhost/api/parts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  )

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: partsPOST } = (await import('@/app/api/parts/route')) as any)
  ;({ PATCH: partPATCH } = (await import('@/app/api/parts/[id]/route')) as any)
  ;({ GET: suppliersGET } = (await import('@/app/api/suppliers/route')) as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  h.session = { user: { id: 'user-a', name: 'Alice', role: 'OWNER', garageId: garageA } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('POST /api/parts — le fournisseur est réellement enregistrable', () => {
  it('persiste supplierName et supplierRef', async () => {
    const res = await creerPiece({
      name: 'Plaquettes de frein avant',
      reference: 'PLQ-AV-208',
      quantity: 2,
      minQuantity: 6,
      unitCost: 23.1,
      unitPrice: 45.9,
      supplierName: 'AutoDistrib',
      supplierRef: 'AD-PLQ-208',
    })
    expect(res.status).toBe(201)

    const enBase = await prisma.part.findFirst({ where: { garageId: garageA, reference: 'PLQ-AV-208' } })
    expect(enBase.supplierName).toBe('AutoDistrib')
    expect(enBase.supplierRef).toBe('AD-PLQ-208')
  })

  it('une pièce sans fournisseur reste valide (le champ est facultatif)', async () => {
    const res = await creerPiece({ name: 'Vis', quantity: 100, minQuantity: 10 })
    expect(res.status).toBe(201)
    const enBase = await prisma.part.findFirst({ where: { garageId: garageA, name: 'Vis' } })
    expect(enBase.supplierName).toBeNull()
  })

  it('les espaces de bordure sont retirés, une saisie vide vaut « pas de fournisseur »', async () => {
    // Normalize supplier metadata at the boundary so stored labels stay consistent.
    const res = await creerPiece({ name: 'Durite', quantity: 1, minQuantity: 5, supplierName: '  Oscaro  ', supplierRef: '   ' })
    expect(res.status).toBe(201)
    const enBase = await prisma.part.findFirst({ where: { garageId: garageA, name: 'Durite' } })
    expect(enBase.supplierName).toBe('Oscaro')
    expect(enBase.supplierRef).toBeNull()
  })

  it('un nom de fournisseur démesuré est refusé, pas tronqué en silence', async () => {
    const res = await creerPiece({ name: 'X', supplierName: 'A'.repeat(200) })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/parts/[id] — le fournisseur est modifiable', () => {
  it('change le fournisseur d\'une pièce existante', async () => {
    const piece = await prisma.part.findFirst({ where: { garageId: garageA, reference: 'PLQ-AV-208' } })
    const res = await modifierPiece(piece.id, { supplierName: 'Mecapièces', supplierRef: 'MP-77' })
    expect(res.status).toBe(200)

    const apres = await prisma.part.findUnique({ where: { id: piece.id } })
    expect(apres.supplierName).toBe('Mecapièces')
    expect(apres.supplierRef).toBe('MP-77')
  })
})

describe('GET /api/suppliers — no fabricated quote from supplier metadata', () => {
  it('returns an explicit unavailable response even when supplier names/SKUs exist', async () => {
    const res = await suppliersGET(new Request('http://localhost/api/suppliers'))
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.error).toBe('SUPPLIER_INTEGRATION_REQUIRED')
    expect(body).not.toHaveProperty('orders')
    expect(body.message).toMatch(/prix.*disponibilit.*délais/i)
  })
})

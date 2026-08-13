/**
 * GF31-AUD-030 — corriger un inventaire écrasait les ventes et ne laissait
 * aucune trace.
 *
 * `PATCH /api/parts/[id]` posait `quantity` en valeur ABSOLUE, par un `update`
 * nu : ni transaction, ni condition sur l'état lu, ni `StockMovement`.
 *
 * 1. MISE À JOUR PERDUE. L'écran envoie la valeur qu'il AFFICHE. Si une facture
 *    a décrémenté la pièce entre l'affichage et l'envoi, la vente est
 *    réintroduite en stock : 10 affiché, on corrige à 12, une facture sort 3
 *    unités — on attend 9, on obtient 12.
 * 2. AUCUNE TRAÇABILITÉ. Le moteur de facturation écrit un mouvement pour
 *    chaque unité qui bouge (§45), et `DELETE /api/parts/[id]` refuse d'effacer
 *    une pièce mouvementée POUR PRÉSERVER ce journal (GF31-AUD-015) — mais la
 *    correction manuelle, elle, ne laissait rien. L'origine d'un écart de stock
 *    était donc irreconstituable, ce qui vide le journal de son sens.
 *
 * Base SQLite réelle + vraies routes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-part-adjust.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let PATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PATCH } = (await import('@/app/api/parts/[id]/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Inventaire', slug: 'aud-030' } })).id
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

async function piece(nom: string, quantite: number): Promise<string> {
  return (await prisma.part.create({
    data: {
      garageId, name: nom, quantity: quantite, minQuantity: 0,
      unitCostTenThousandths: 100000, unitPriceTenThousandths: 200000,
    },
  })).id
}

function corriger(id: string, corps: Record<string, unknown>) {
  return PATCH(
    new Request(`http://localhost/api/parts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  )
}

const quantiteDe = async (id: string) => (await prisma.part.findUnique({ where: { id } })).quantity
const mouvementsDe = (id: string) => prisma.stockMovement.findMany({ where: { partId: id }, orderBy: { createdAt: 'asc' } })

describe('GF31-AUD-030 — correction d’inventaire conditionnelle', () => {
  it('refuse une correction qui n’annonce pas la quantité observée', async () => {
    const p = await piece('Sans témoin', 10)
    const res = await corriger(p, { quantity: 12 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('EXPECTED_QUANTITY_REQUIRED')
    expect(await quantiteDe(p)).toBe(10)
  })

  it('applique la correction et écrit un mouvement ADJUST signé', async () => {
    const p = await piece('Corrigée', 10)
    const res = await corriger(p, { quantity: 12, expectedQuantity: 10 })
    expect(res.status).toBe(200)
    expect(await quantiteDe(p)).toBe(12)

    const mvts = await mouvementsDe(p)
    expect(mvts).toHaveLength(1)
    expect(mvts[0].type).toBe('ADJUST')
    expect(mvts[0].quantityDelta).toBe(2)
    expect(mvts[0].reason).toContain('10')
    expect(mvts[0].reason).toContain('12')
    expect(mvts[0].invoiceId).toBeNull()
  })

  it('une correction à la BAISSE écrit un delta négatif', async () => {
    const p = await piece('Casse', 10)
    expect((await corriger(p, { quantity: 4, expectedQuantity: 10 })).status).toBe(200)
    const mvts = await mouvementsDe(p)
    expect(mvts[0].quantityDelta).toBe(-6)
    expect(await quantiteDe(p)).toBe(4)
  })

  it('LE DÉFAUT : une vente concurrente n’est plus écrasée', async () => {
    const p = await piece('Disputée', 10)
    // L'écran a lu 10. Entre-temps, une facture sort 3 unités.
    await prisma.part.update({ where: { id: p }, data: { quantity: { decrement: 3 } } })

    const res = await corriger(p, { quantity: 12, expectedQuantity: 10 })
    expect(res.status).toBe(409)
    const corps = await res.json()
    expect(corps.code).toBe('STOCK_CONFLICT')
    expect(corps.currentQuantity).toBe(7)
    // Rien n'a été réécrit par-dessus la vente.
    expect(await quantiteDe(p)).toBe(7)
    expect(await mouvementsDe(p)).toHaveLength(0)
  })

  it('deux corrections CONCURRENTES : une seule aboutit', async () => {
    const p = await piece('Course', 10)
    const [a, b] = await Promise.all([
      corriger(p, { quantity: 12, expectedQuantity: 10 }),
      corriger(p, { quantity: 20, expectedQuantity: 10 }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const mvts = await mouvementsDe(p)
    expect(mvts).toHaveLength(1)
    expect(await quantiteDe(p)).toBe(10 + mvts[0].quantityDelta)
  })

  it('une correction sans changement réel n’invente pas de mouvement', async () => {
    const p = await piece('Inchangée', 10)
    expect((await corriger(p, { quantity: 10, expectedQuantity: 10 })).status).toBe(200)
    expect(await mouvementsDe(p)).toHaveLength(0)
  })

  it('les champs descriptifs restent modifiables sans témoin de quantité', async () => {
    const p = await piece('Renommée', 10)
    const res = await corriger(p, { name: 'Nouveau nom', location: 'B12' })
    expect(res.status).toBe(200)
    const apres = await prisma.part.findUnique({ where: { id: p } })
    expect(apres.name).toBe('Nouveau nom')
    expect(apres.quantity).toBe(10)
    expect(await mouvementsDe(p)).toHaveLength(0)
  })

  it('la correction accompagnée d’autres champs les applique dans la MÊME transaction', async () => {
    const p = await piece('Combinée', 10)
    expect((await corriger(p, { quantity: 15, expectedQuantity: 10, location: 'A1' })).status).toBe(200)
    const apres = await prisma.part.findUnique({ where: { id: p } })
    expect(apres.quantity).toBe(15)
    expect(apres.location).toBe('A1')
  })

  it('rien n’est appliqué quand le conflit survient, pas même les champs descriptifs', async () => {
    const p = await piece('Atomique', 10)
    await prisma.part.update({ where: { id: p }, data: { quantity: 7 } })
    expect((await corriger(p, { quantity: 15, expectedQuantity: 10, location: 'ZZZ' })).status).toBe(409)
    expect((await prisma.part.findUnique({ where: { id: p } })).location).toBeNull()
  })

  it.each(['RECEPTIONIST', 'MECHANIC', undefined])('%s : correction refusée (stock:manage)', async (role) => {
    const p = await piece('Protégée ' + String(role), 10)
    const precedent = h.session
    h.session = { user: { id: 'u2', role, garageId } }
    try {
      expect((await corriger(p, { quantity: 99, expectedQuantity: 10 })).status).toBe(403)
      expect(await quantiteDe(p)).toBe(10)
    } finally {
      h.session = precedent
    }
  })

  it('un autre garage ne corrige pas mes pièces', async () => {
    const p = await piece('Mienne', 10)
    const precedent = h.session
    const autre = (await prisma.garage.create({ data: { name: 'Autre', slug: 'aud-030-b' } })).id
    h.session = { user: { id: 'u3', role: 'OWNER', garageId: autre } }
    try {
      expect((await corriger(p, { quantity: 99, expectedQuantity: 10 })).status).toBe(404)
      expect(await quantiteDe(p)).toBe(10)
    } finally {
      h.session = precedent
    }
  })
})

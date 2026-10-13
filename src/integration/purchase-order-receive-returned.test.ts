/**
 * GF-FINAL-025 — un bon RETOURNÉ pouvait être re-réceptionné (double stock).
 *
 * La revendication atomique du statut excluait `received` et `cancelled`, mais
 * pas `returned`. Or un retour DÉCRÉMENTE le stock : réceptionner à nouveau une
 * commande retournée le ré-incrémentait, c'est-à-dire exactement le double
 * comptage que cette revendication existe pour empêcher. Le cycle de vie est
 * draft → sent → confirmed → received → returned : `returned` est terminal au
 * même titre que `received`.
 *
 * GF-FINAL-026 — la réception n'était atteignable depuis AUCUN écran.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'
import { serializePoLinesJsonV2 } from '@/lib/money-json'
import { toScaled } from '@/lib/money'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-po-returned.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let receive: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let prisma: any
let garageId: string
let partId: string

const receptionner = (id: string) =>
  receive(new Request(`http://x/api/purchase-orders/${id}/receive`, { method: 'POST' }), { params: { id } })

async function bon(status: string, qty: number) {
  // `linesJson` passe par le SÉRIALISEUR v2 : la doctrine monétaire du projet
  // interdit l'écriture directe d'un format à propriétés flottantes, et une
  // garde le vérifie (check:money-json). Un test qui contournerait la règle
  // n'éprouverait pas le même format que la production.
  const linesJson = serializePoLinesJsonV2([
    {
      partId,
      partName: 'Plaquettes',
      reference: null,
      qtyTenThousandths: toScaled(qty),
      unitCostTenThousandths: toScaled(10),
      lineTotalCents: qty * 10 * 100,
    },
  ])
  return (await prisma.purchaseOrder.create({
    data: {
      garageId, number: `BC-${status}-${qty}-${Math.random().toString(36).slice(2, 7)}`,
      supplierName: 'Oscaro', status, totalHtCents: 1000, linesJson,
    },
  })).id
}

const stock = async () => (await prisma.part.findUnique({ where: { id: partId } })).quantity

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: receive } = (await import('@/app/api/purchase-orders/[id]/receive/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  partId = (await prisma.part.create({
    data: { garageId, name: 'Plaquettes', quantity: 0, minQuantity: 5, unitCostTenThousandths: 100000, unitPriceTenThousandths: 200000 },
  })).id
  h.session = { user: { id: 'u', name: 'A', role: 'OWNER', garageId } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('réception d\'un bon de commande', () => {
  it('incrémente le stock exactement une fois', async () => {
    const avant = await stock()
    const id = await bon('sent', 8)
    expect((await receptionner(id)).status).toBe(200)
    expect(await stock()).toBe(avant + 8)
  })

  it('un second appel sur le MÊME bon n\'incrémente pas une seconde fois', async () => {
    const id = await bon('sent', 5)
    await receptionner(id)
    const apresPremiere = await stock()
    expect((await receptionner(id)).status).toBe(409)
    expect(await stock()).toBe(apresPremiere)
  })

  it('un bon RETOURNÉ ne peut pas être réceptionné — le défaut corrigé', async () => {
    const id = await bon('returned', 7)
    const avant = await stock()
    const res = await receptionner(id)
    expect(res.status).toBe(409)
    // Le point décisif : le stock n'a pas bougé.
    expect(await stock()).toBe(avant)
    // …et le bon reste retourné, il ne bascule pas en « réceptionné ».
    expect((await prisma.purchaseOrder.findUnique({ where: { id } })).status).toBe('returned')
  })

  it('un bon annulé reste refusé', async () => {
    const id = await bon('cancelled', 4)
    const avant = await stock()
    expect((await receptionner(id)).status).toBe(400)
    expect(await stock()).toBe(avant)
  })

  // Délai explicite : trois transactions SQLite concurrentes se sérialisent
  // sur le verrou d'écriture du fichier — sous charge CI, le délai par défaut
  // de 5 s était atteint alors même que la revendication atomique fonctionnait
  // (constaté en CI : « Test timed out in 5000ms », un seul incrément au final).
  it('deux réceptions CONCURRENTES du même bon n\'incrémentent qu\'une fois', async () => {
    const id = await bon('confirmed', 6)
    const avant = await stock()
    const resultats = await Promise.all([receptionner(id), receptionner(id), receptionner(id)])
    expect(resultats.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await stock()).toBe(avant + 6)
  }, 20_000)

  it('un bon d\'un AUTRE garage est introuvable', async () => {
    const autre = (await prisma.garage.create({ data: { name: 'B', slug: `b-${Math.random().toString(36).slice(2, 7)}` } })).id
    const id = (await prisma.purchaseOrder.create({
      data: { garageId: autre, number: `BC-B-${Math.random().toString(36).slice(2, 7)}`, supplierName: 'X', status: 'sent', totalHtCents: 100, linesJson: '[]' },
    })).id
    expect((await receptionner(id)).status).toBe(404)
  })
})

describe('la réception est atteignable depuis le produit', () => {
  it('le panneau Fournisseurs appelle réellement la route de réception', async () => {
    // Le stock n'était jamais réapprovisionné : la route existait, mais aucun
    // écran ne l'appelait — le bon restait « brouillon » indéfiniment.
    const src = fs.readFileSync(path.resolve(__dirname, '../components/SuppliersPanel.tsx'), 'utf8')
    expect(src).toMatch(/\/api\/purchase-orders\/\$\{[^}]+\}\/receive/)
    expect(src).toContain("method: 'POST'")
    // La liste des bons existants est chargée, sinon il n'y a rien à réceptionner.
    expect(src).toContain("fetch('/api/purchase-orders')")
    // Un refus du serveur est affiché, jamais avalé.
    expect(src).toMatch(/setErreurReception\(/)
  })
})

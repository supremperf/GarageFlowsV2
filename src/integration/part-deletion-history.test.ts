/**
 * GF31-AUD-015 — supprimer une pièce ne doit ni effacer l'historique comptable
 * ni geler une facture.
 *
 * `StockMovement.part` est déclaré `onDelete: Cascade` dans les DEUX schémas :
 * supprimer une pièce EFFACE tout son journal de mouvements. Deux conséquences
 * s'enchaînaient :
 *
 * 1. la cause d'une variation de stock devenait irreconstituable — l'inverse de
 *    ce qu'un journal de mouvements est censé garantir ;
 * 2. `reconcile()` levait `InventoryError(409, 'Restitution impossible…')` dès
 *    qu'une pièce restituée n'existait plus, si bien que **toute facture ayant
 *    consommé une pièce ensuite supprimée devenait définitivement
 *    inannulable** — sans aucun recours. Le commentaire du code annonçait
 *    pourtant l'inverse : « on ne bloque pas l'annulation de la facture pour
 *    autant ».
 *
 * Base SQLite réelle : la cascade et la clé étrangère sont celles du produit.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-part-history.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let partDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let releaseInvoiceStock: typeof import('@/lib/stock/invoice-stock').releaseInvoiceStock
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ DELETE: partDELETE } = (await import('@/app/api/parts/[id]/route')) as any)
  ;({ releaseInvoiceStock } = await import('@/lib/stock/invoice-stock'))

  garageId = (await prisma.garage.create({ data: { name: 'Hist', slug: 'aud-015' } })).id
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

async function creerPiece(nom: string, quantite: number): Promise<string> {
  return (await prisma.part.create({
    data: {
      garageId, name: nom, quantity: quantite, minQuantity: 0,
      unitCostTenThousandths: 100000, unitPriceTenThousandths: 200000,
    },
  })).id
}

describe('GF31-AUD-015 — une pièce avec historique n’est pas supprimable', () => {
  it('refuse la suppression et CONSERVE les mouvements', async () => {
    const partId = await creerPiece('Filtre historisé', 10)
    const invoiceId = (await prisma.invoice.create({
      data: { number: 'FAC-H-1', garageId, clientName: 'C', status: 'sent', issueDate: '2026-06-01', taxRate: 20 },
    })).id
    await prisma.stockMovement.create({
      data: { garageId, partId, type: 'SALE', quantityDelta: -2, invoiceId, reason: 'vente' },
    })

    const res = await partDELETE(
      new Request('http://localhost/api/parts/x', { method: 'DELETE' }),
      { params: { id: partId } },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PART_HAS_HISTORY')

    // L'invariant : ni la pièce ni son journal n'ont disparu.
    expect(await prisma.part.count({ where: { id: partId } })).toBe(1)
    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(1)
  })

  it('laisse supprimer une pièce jamais mouvementée (cas courant, non entravé)', async () => {
    const partId = await creerPiece('Référence abandonnée', 0)
    const res = await partDELETE(
      new Request('http://localhost/api/parts/x', { method: 'DELETE' }),
      { params: { id: partId } },
    )
    expect(res.status).toBe(200)
    expect(await prisma.part.count({ where: { id: partId } })).toBe(0)
  })
})

describe('GF31-AUD-015 — une facture reste annulable même si la pièce a disparu', () => {
  it('restitue ce qui existe, ignore ce qui n’existe plus, et n’échoue pas', async () => {
    const presente = await creerPiece('Pièce toujours là', 5)
    const disparue = await creerPiece('Pièce qui sera supprimée', 5)

    const invoiceId = (await prisma.invoice.create({
      data: {
        number: 'FAC-H-2', garageId, clientName: 'C', status: 'sent',
        issueDate: '2026-06-02', taxRate: 20,
        stockCommittedAt: new Date(),
        lines: {
          create: [
            { description: 'A', sortOrder: 0, quantityTenThousandths: 20000, unitPriceTenThousandths: 200000, unitCostTenThousandths: 100000, partId: presente },
            { description: 'B', sortOrder: 1, quantityTenThousandths: 30000, unitPriceTenThousandths: 200000, unitCostTenThousandths: 100000, partId: disparue },
          ],
        },
      },
    })).id

    // Vente déjà engagée : 2 unités de l'une, 3 de l'autre.
    await prisma.stockMovement.createMany({
      data: [
        { garageId, partId: presente, type: 'SALE', quantityDelta: -2, invoiceId, reason: 'vente' },
        { garageId, partId: disparue, type: 'SALE', quantityDelta: -3, invoiceId, reason: 'vente' },
      ],
    })
    await prisma.part.update({ where: { id: presente }, data: { quantity: 3 } })
    await prisma.part.update({ where: { id: disparue }, data: { quantity: 2 } })

    // La pièce est supprimée EN BASE (cas hérité : la garde ci-dessus n'existait
    // pas encore quand la donnée a été produite). La cascade emporte son journal.
    await prisma.part.delete({ where: { id: disparue } })
    expect(await prisma.stockMovement.count({ where: { partId: disparue } })).toBe(0)

    // L'annulation ne doit PAS échouer.
    const res = await prisma.$transaction(async (tx: any) =>
      releaseInvoiceStock(tx, { invoiceId, garageId, number: 'FAC-H-2' }),
    )

    expect(res.changed).toBe(true)
    // Les 2 unités de la pièce encore présente sont bien revenues en stock.
    expect((await prisma.part.findFirst({ where: { id: presente } })).quantity).toBe(5)

    // `missingParts` est vide ICI, et c'est exact : la cascade ayant emporté les
    // mouvements de la pièce supprimée, l'engagement reconstitué depuis le
    // journal ne la mentionne plus — il n'y a donc rien à lui restituer. Les 3
    // unités qu'elle avait consommées sont définitivement perdues pour
    // l'inventaire : c'est précisément ce que la garde posée sur
    // `DELETE /api/parts/[id]` empêche désormais de reproduire.
    //
    // Le champ reste néanmoins renseigné quand un mouvement SURVIT à sa pièce
    // (bases où la cascade n'a pas été appliquée), cas couvert par le test
    // unitaire du moteur.
    expect(res.missingParts).toEqual([])
  })
})

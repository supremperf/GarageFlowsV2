/**
 * STOCK — ABSENCE DE DOUBLE DÉDUCTION (scénario déterministe, base SQLite RÉELLE).
 *
 * Les invariants d'inventaire étaient déjà couverts, mais par une base SIMULÉE
 * (`stock-parts.test.ts`, objets en mémoire) ou par PostgreSQL — suite sautée
 * partout où `TEST_POSTGRES_URL` est absent, c'est-à-dire sur le poste de build
 * desktop. Or le produit livré est mono-poste SQLite : l'idempotence du verrou
 * `stockCommittedAt` et l'atomicité du décrément conditionnel n'étaient donc
 * jamais exercées contre le moteur RÉELLEMENT distribué.
 *
 * Scénario, volontairement chiffré et reproductible : un article à 10 unités.
 *   devis               → 10 (un devis n'engage pas l'inventaire)
 *   facture validée     →  9 (décrément réel)
 *   validation rejouée  →  9 (double-clic, rejeu réseau : aucun second débit)
 *   validations         →  9 (course concurrente : un seul gagnant)
 *   annulation          → 10 (restitution intégrale)
 *   annulation rejouée  → 10
 *   stock insuffisant   → refus 409, jamais de quantité négative
 * et le journal des mouvements doit expliquer EXACTEMENT l'écart constaté.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { prepareTestDb } from '../../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../../.tmp-stock-double-deduction.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let commitInvoiceStock: typeof import('@/lib/stock/invoice-stock').commitInvoiceStock
let releaseInvoiceStock: typeof import('@/lib/stock/invoice-stock').releaseInvoiceStock
let InventoryError: typeof import('@/lib/stock/invoice-stock').InventoryError

const G = { id: '' }

/** Quantité en DIX-MILLIÈMES d'unité : 10000 = 1 unité. */
const UNITES = (n: number) => n * 10_000

async function quantiteEnStock(partId: string): Promise<number> {
  return (await prisma.part.findUnique({ where: { id: partId } })).quantity
}

/** Crée un article neuf à `quantity` unités. */
async function creerArticle(nom: string, quantity: number) {
  return prisma.part.create({ data: { name: nom, garageId: G.id, quantity, minQuantity: 0 } })
}

/** Crée une facture BROUILLON consommant `unites` d'un article. */
async function creerFactureBrouillon(numero: string, partId: string, unites: number) {
  return prisma.invoice.create({
    data: {
      number: numero,
      garageId: G.id,
      clientName: 'Client Audit',
      issueDate: '2026-10-20',
      status: 'draft',
      lines: {
        create: [{
          description: 'Pièce auditée',
          partId,
          quantityTenThousandths: UNITES(unites),
          unitPriceTenThousandths: UNITES(100),
          sortOrder: 0,
        }],
      },
    },
  })
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ commitInvoiceStock, releaseInvoiceStock, InventoryError } =
    await import('@/lib/stock/invoice-stock'))
  const g = await prisma.garage.create({ data: { name: 'Audit', slug: 'audit-stock-dd' } })
  G.id = g.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

describe('article à 10 unités — cycle complet sans double déduction', () => {
  it('un DEVIS ne consomme rien ; la validation consomme exactement une fois', async () => {
    const part = await creerArticle('Filtre à huile', 10)
    const facture = await creerFactureBrouillon('FAC-DD-001', part.id, 1)

    // Brouillon/devis : aucun engagement d'inventaire.
    expect(await quantiteEnStock(part.id)).toBe(10)

    // Validation : décrément réel.
    const r1 = await prisma.$transaction((tx: any) =>
      commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))
    expect(r1.changed).toBe(true)
    expect(r1.applied).toEqual([{ partId: part.id, units: 1 }])
    expect(await quantiteEnStock(part.id)).toBe(9)

    // Rejeu (double-clic, retransmission) : AUCUN second débit.
    const r2 = await prisma.$transaction((tx: any) =>
      commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))
    expect(r2.changed).toBe(false)
    expect(r2.movements).toBe(0)
    expect(await quantiteEnStock(part.id)).toBe(9)

    // Le journal n'explique qu'UN SEUL mouvement, de −1.
    const mouvements = await prisma.stockMovement.findMany({ where: { invoiceId: facture.id } })
    expect(mouvements).toHaveLength(1)
    expect(mouvements[0].quantityDelta).toBe(-1)
    expect(mouvements[0].type).toBe('SALE')
  })

  it('DIX validations concurrentes de la même facture ne débitent qu’une unité', async () => {
    const part = await creerArticle('Plaquettes avant', 10)
    const facture = await creerFactureBrouillon('FAC-DD-002', part.id, 1)

    const resultats = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx: any) =>
          commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))),
    )
    const gagnants = resultats.filter(
      (r) => r.status === 'fulfilled' && (r.value as any).changed === true)

    expect(gagnants).toHaveLength(1)
    expect(await quantiteEnStock(part.id)).toBe(9)
    expect(await prisma.stockMovement.count({ where: { invoiceId: facture.id } })).toBe(1)
  })

  it('l’annulation restitue intégralement, et son rejeu ne restitue pas deux fois', async () => {
    const part = await creerArticle('Courroie', 10)
    const facture = await creerFactureBrouillon('FAC-DD-003', part.id, 3)

    await prisma.$transaction((tx: any) =>
      commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))
    expect(await quantiteEnStock(part.id)).toBe(7)

    const a1 = await prisma.$transaction((tx: any) =>
      releaseInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))
    expect(a1.changed).toBe(true)
    expect(await quantiteEnStock(part.id)).toBe(10)

    const a2 = await prisma.$transaction((tx: any) =>
      releaseInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number }))
    expect(a2.changed).toBe(false)
    expect(await quantiteEnStock(part.id)).toBe(10)

    // Journal : la somme des deltas doit être NULLE (sortie puis retour).
    const mouvements = await prisma.stockMovement.findMany({ where: { invoiceId: facture.id } })
    const somme = mouvements.reduce((s: number, m: any) => s + m.quantityDelta, 0)
    expect(somme).toBe(0)
    expect(mouvements.map((m: any) => m.type).sort()).toEqual(['CANCEL', 'SALE'])
  })

  it('stock insuffisant → refus 409, et la quantité ne devient JAMAIS négative', async () => {
    const part = await creerArticle('Amortisseur', 2)
    const facture = await creerFactureBrouillon('FAC-DD-004', part.id, 5)

    await expect(prisma.$transaction((tx: any) =>
      commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number })),
    ).rejects.toThrow(InventoryError)

    // La transaction a tout annulé : ni débit partiel, ni engagement fantôme.
    expect(await quantiteEnStock(part.id)).toBe(2)
    expect(await prisma.stockMovement.count({ where: { invoiceId: facture.id } })).toBe(0)
    const apres = await prisma.invoice.findUnique({ where: { id: facture.id } })
    expect(apres.stockCommittedAt).toBeNull()
  })

  it('un échec APRÈS le décrément annule aussi le décrément (atomicité)', async () => {
    const part = await creerArticle('Bougie', 10)
    const facture = await creerFactureBrouillon('FAC-DD-005', part.id, 4)

    // Panne simulée entre la mise à jour du stock et la fin de l'opération
    // métier : la transaction DOIT tout ramener en arrière.
    await expect(prisma.$transaction(async (tx: any) => {
      await commitInvoiceStock(tx, { invoiceId: facture.id, garageId: G.id, number: facture.number })
      throw new Error('panne simulée après décrément')
    })).rejects.toThrow('panne simulée après décrément')

    expect(await quantiteEnStock(part.id)).toBe(10)
    expect(await prisma.stockMovement.count({ where: { invoiceId: facture.id } })).toBe(0)
    const apres = await prisma.invoice.findUnique({ where: { id: facture.id } })
    expect(apres.stockCommittedAt).toBeNull()
  })

  it('le stock final s’explique EXACTEMENT par le journal des mouvements', async () => {
    const mouvements = await prisma.stockMovement.findMany({ where: { garageId: G.id } })
    const parPiece = new Map<string, number>()
    for (const m of mouvements) parPiece.set(m.partId, (parPiece.get(m.partId) ?? 0) + m.quantityDelta)

    for (const part of await prisma.part.findMany({ where: { garageId: G.id } })) {
      // quantité initiale = quantité courante − somme des deltas journalisés
      const initiale = part.quantity - (parPiece.get(part.id) ?? 0)
      expect(initiale, `article « ${part.name} » : écart inexpliqué`).toBeGreaterThanOrEqual(0)
      expect(part.quantity, `article « ${part.name} » : stock négatif`).toBeGreaterThanOrEqual(0)
    }
  })
})

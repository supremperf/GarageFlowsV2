/**
 * GF-037 — supprimer une pièce, et journaliser ce qui ENTRE en stock.
 *
 * ─── Trois défauts d'une même zone ──────────────────────────────────────────
 * 1. `DELETE /api/parts/[id]` : `JobPart.partId` est en `RESTRICT`. Supprimer
 *    une pièce posée sur une intervention violait la clé étrangère, et le filet
 *    générique traduisait l'exception en « Une erreur interne est survenue »
 *    (500). Ni cause, ni remède. La garde existante ne comptait que les
 *    `StockMovement` — et poser une pièce sur une intervention n'en écrivait
 *    aucun jusqu'à GF-028, donc le compteur valait zéro.
 *
 * 2. Le schéma déclare `onDelete: SetNull` sur `InvoiceLine.partId` et
 *    `QuoteLine.partId`, et la migration du CLOUD crée la contrainte ; celle du
 *    POSTE n'a ajouté que des colonnes TEXT nues — SQLite ne sait pas poser une
 *    contrainte sur une table existante. Sur un poste, la suppression laissait
 *    un `partId` ORPHELIN, et la facture devenait invalidable : 409 « Pièce
 *    introuvable », sans rien pour guider. Le même geste passait côté cloud.
 *
 * 3. `StockMovement` ne recevait aucune ENTRÉE : ni réception de bon de
 *    commande, ni retour fournisseur. Le journal ne montrait que des sorties,
 *    alors que le schéma pose le stock comme reconstituable à partir de lui.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-stock-suppression.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: () => {}, scheduleJobSync: () => {} }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
let partDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let receivePOST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', mecano: '', job: '' }
let compteur = 0

const creerPiece = (quantity = 10) => prisma.part.create({
  data: {
    garageId: ids.garage, name: `Pièce ${++compteur}`, reference: `REF-${compteur}`,
    quantity, unitPriceTenThousandths: 120_000, unitCostTenThousandths: 60_000,
  },
})

const supprimer = (id: string) =>
  partDELETE(new Request('http://localhost/api/parts/x', { method: 'DELETE' }), { params: { id } })

/**
 * Lignes d'un bon de commande, sérialisées par le MÊME code que le produit.
 * Écrire le JSON à la main testerait ma compréhension du format, pas la route.
 */
let serialiserLignes: (l: any[]) => string
const lignesBon = (piece: any, qte: number) => serialiserLignes([{
  partId: piece.id,
  partName: piece.name,
  reference: piece.reference,
  qtyTenThousandths: qte * 10_000,
  unitCostTenThousandths: 60_000,
  lineTotalCents: qte * 600,
}])

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ DELETE: partDELETE } = (await import('@/app/api/parts/[id]/route')) as any)
  ;({ POST: receivePOST } = (await import('@/app/api/purchase-orders/[id]/receive/route')) as any)
  ;({ serializePoLinesJsonV2: serialiserLignes } = (await import('@/lib/money-json')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Stock', slug: 'stock-suppression' } })
  const mecano = await prisma.mechanic.create({
    data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id },
  })
  ids.garage = garage.id; ids.mecano = mecano.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }

  ids.job = (await prisma.job.create({
    data: {
      garageId: garage.id, mechanicId: mecano.id, customerName: 'C', vehicleModel: 'V',
      repairType: 'oil_change', estimatedDuration: 60, startTime: '09:00', date: '2026-08-14',
    },
  })).id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  await prisma.stockMovement.deleteMany({})
  await prisma.jobPart.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.quoteLine.deleteMany({})
  await prisma.quote.deleteMany({})
  await prisma.purchaseOrder.deleteMany({})
  await prisma.part.deleteMany({})
})

describe('GF-037 — supprimer une pièce dit ce qui l’en empêche', () => {
  it('une pièce jamais utilisée reste librement supprimable', async () => {
    const piece = await creerPiece()
    expect((await supprimer(piece.id)).status).toBe(200)
    expect(await prisma.part.count({ where: { id: piece.id } })).toBe(0)
  })

  it('une pièce POSÉE sur une intervention : refus métier, pas une 500', async () => {
    const piece = await creerPiece()
    await prisma.jobPart.create({
      data: {
        jobId: ids.job, partId: piece.id, quantity: 2,
        unitPriceTenThousandths: 120_000, unitCostTenThousandths: 60_000,
      },
    })

    const res = await supprimer(piece.id)
    const corps = await res.json()
    expect(res.status, 'la clé étrangère produisait un 500 « erreur interne »').toBe(409)
    expect(corps.code).toBe('PART_USED_BY_JOB')
    expect(corps.error, 'le message doit dire quoi faire').toMatch(/intervention/i)
    expect(corps.error).toContain(piece.name)
    expect(corps.error, 'aucun détail technique exposé (§83)').not.toMatch(/prisma|P2003|foreign key/i)
    expect(await prisma.part.count({ where: { id: piece.id } }), 'rien n’est supprimé').toBe(1)
  })

  it('une ligne de FACTURE est déliée, jamais laissée orpheline', async () => {
    const piece = await creerPiece()
    const facture = await prisma.invoice.create({
      data: {
        garageId: ids.garage, number: 'FAC-2026-DEL', clientName: 'X',
        status: 'draft', issueDate: '2026-08-14', taxRate: 20,
      },
    })
    const ligne = await prisma.invoiceLine.create({
      data: {
        invoiceId: facture.id, description: 'Filtre', sortOrder: 0, partId: piece.id,
        quantityTenThousandths: 1 * 10_000, unitPriceTenThousandths: 12 * 10_000,
      },
    })

    expect((await supprimer(piece.id)).status).toBe(200)
    const apres = await prisma.invoiceLine.findUnique({ where: { id: ligne.id } })
    expect(apres, 'la ligne reste : seul le lien disparaît').toBeTruthy()
    expect(
      apres.partId,
      'un partId orphelin rendait la facture invalidable, sans explication',
    ).toBeNull()
  })

  it('une ligne de DEVIS est déliée elle aussi', async () => {
    const piece = await creerPiece()
    const devis = await prisma.quote.create({
      data: {
        garageId: ids.garage, number: 'DEV-2026-DEL', clientName: 'X',
        status: 'draft', issueDate: '2026-08-14', taxRate: 20,
      },
    })
    const ligne = await prisma.quoteLine.create({
      data: {
        quoteId: devis.id, description: 'Filtre', sortOrder: 0, partId: piece.id,
        quantityTenThousandths: 1 * 10_000, unitPriceTenThousandths: 12 * 10_000,
      },
    })

    expect((await supprimer(piece.id)).status).toBe(200)
    expect((await prisma.quoteLine.findUnique({ where: { id: ligne.id } })).partId).toBeNull()
  })

  it('une pièce AVEC HISTORIQUE de mouvements reste protégée', async () => {
    // Garde préexistante : elle ne doit pas être affaiblie.
    const piece = await creerPiece()
    await prisma.stockMovement.create({
      data: { garageId: ids.garage, partId: piece.id, type: 'SALE', quantityDelta: -1 },
    })
    const res = await supprimer(piece.id)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PART_HAS_HISTORY')
  })

  it('une pièce d’un AUTRE garage reste introuvable', async () => {
    const autre = await prisma.garage.create({ data: { name: 'B', slug: 'stock-voisin' } })
    const pieceB = await prisma.part.create({
      data: {
        garageId: autre.id, name: 'Pièce B', reference: 'REF-B', quantity: 5,
        unitPriceTenThousandths: 10_000, unitCostTenThousandths: 5_000,
      },
    })
    expect((await supprimer(pieceB.id)).status).toBe(404)
    expect(await prisma.part.count({ where: { id: pieceB.id } })).toBe(1)

    await prisma.part.deleteMany({ where: { garageId: autre.id } })
    await prisma.garage.delete({ where: { id: autre.id } })
  })
})

describe('GF-037 — ce qui ENTRE en stock est journalisé', () => {
  it('la réception d’un bon de commande écrit son mouvement', async () => {
    const piece = await creerPiece(4)
    const bon = await prisma.purchaseOrder.create({
      data: {
        garageId: ids.garage, number: 'BC-2026-001', supplierName: 'Fournisseur',
        status: 'confirmed',
        linesJson: lignesBon(piece, 6),
      },
    })

    const res = await receivePOST(
      new Request('http://localhost/api/purchase-orders/x/receive', { method: 'POST' }),
      { params: { id: bon.id } },
    )
    expect(res.status, await res.clone().text()).toBe(200)

    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(10)
    const mvts = await prisma.stockMovement.findMany({ where: { partId: piece.id } })
    expect(mvts, 'la principale ENTRÉE de stock n’était pas journalisée').toHaveLength(1)
    expect(mvts[0].quantityDelta).toBe(6)
    expect(mvts[0].reason).toContain('BC-2026-001')
    expect(4 + mvts.reduce((s: number, m: any) => s + m.quantityDelta, 0)).toBe(10)
  })

  it('une réception REJOUÉE n’écrit pas un second mouvement', async () => {
    const piece = await creerPiece(0)
    const bon = await prisma.purchaseOrder.create({
      data: {
        garageId: ids.garage, number: 'BC-2026-002', supplierName: 'F', status: 'confirmed',
        linesJson: lignesBon(piece, 3),
      },
    })
    const appel = () => receivePOST(
      new Request('http://localhost/api/purchase-orders/x/receive', { method: 'POST' }),
      { params: { id: bon.id } },
    )

    expect((await appel()).status).toBe(200)
    expect((await appel()).status, 'seconde réception refusée').toBe(409)

    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(3)
    expect(await prisma.stockMovement.count({ where: { partId: piece.id } })).toBe(1)
  })
})

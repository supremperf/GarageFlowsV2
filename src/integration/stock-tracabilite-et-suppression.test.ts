/**
 * GF-028 / GF-029 — le stock ment moins, et une facture émise ne s'efface plus.
 *
 * ─── GF-028 : le seul mouvement de stock qui n'était pas journalisé ──────────
 * `prisma/schema.prisma` pose l'invariant : le stock d'une pièce est toujours
 * reconstituable à partir de `StockMovement`. C'était vrai pour la validation
 * d'une facture, son annulation, une correction manuelle — mais pas pour le
 * chemin le plus fréquent de tous : poser une pièce sur une intervention. La
 * quantité baissait, aucune ligne n'était écrite. Un écart d'inventaire y
 * devenait littéralement inexplicable : le journal n'en gardait pas la trace.
 *
 * Pire, `JobPart` est en `onDelete: Cascade` sur `Job` : supprimer une
 * intervention effaçait ses lignes de pièces sans restituer quoi que ce soit.
 * Les pièces réservées étaient perdues pour de bon — comptées sorties, sans
 * facture ni intervention pour l'expliquer, et le garage en recommandait.
 *
 * ─── GF-029 : suppression de facture, contrôle hors transaction ──────────────
 * `DELETE /api/invoices/:id` lisait le statut AVANT d'ouvrir la transaction puis
 * supprimait inconditionnellement. Entre les deux, une émission concurrente —
 * un second onglet, la seconde moitié d'un double-clic — et une facture ÉMISE
 * partait physiquement, avec son numéro de la série séquentielle. Aucun avoir,
 * aucune reprise possible : un trou dans la numérotation au contrôle FEC.
 */
type OriginalModule1 = typeof import('@/lib/api-helpers')
type OriginalModule2 = typeof import('@/lib/stock/invoice-stock')

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-stock-tracabilite.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any, emettrePendantLaTransaction: false }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: () => {}, scheduleJobSync: () => {} }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

/**
 * Fenêtre de course reproduite À L'IDENTIQUE, sans mock du code testé.
 *
 * La logique de stock reste la VRAIE (`importOriginal`) ; on se sert seulement
 * de son appel comme point d'injection, parce qu'il tombe exactement dans
 * l'intervalle vulnérable : après la lecture du statut, avant la suppression.
 * Émettre la facture depuis `tx` équivaut, du point de vue de la ligne
 * supprimée, à une émission concurrente arrivée dans cet intervalle. Un
 * `prisma.invoice.update` lancé de l'extérieur ne le prouverait pas : SQLite
 * sérialise les écritures et attendrait la fin de la transaction.
 */
vi.mock('@/lib/stock/invoice-stock', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule2>()
  return {
    ...reel,
    releaseInvoiceStock: async (tx: any, args: any) => {
      const r = await reel.releaseInvoiceStock(tx, args)
      if (h.emettrePendantLaTransaction) {
        await tx.invoice.update({ where: { id: args.invoiceId }, data: { status: 'sent' } })
      }
      return r
    },
  }
})

let prisma: any
let partsPOST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let partsDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let jobDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let invoiceDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', mecano: '' }

const poser = (jobId: string, partId: string, quantity?: number) =>
  partsPOST(new Request('http://localhost/api/jobs/x/parts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(quantity === undefined ? { partId } : { partId, quantity }),
  }), { params: { id: jobId } })

const retirer = (jobId: string, jobPartId: string) =>
  partsDELETE(new Request('http://localhost/api/jobs/x/parts', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobPartId }),
  }), { params: { id: jobId } })

/** Crée une intervention nue rattachée au garage de la session. */
const creerJob = () => prisma.job.create({
  data: {
    garageId: ids.garage, mechanicId: ids.mecano, customerName: 'Client Stock',
    vehicleModel: 'Clio', repairType: 'oil_change', estimatedDuration: 60,
    startTime: '09:00', date: '2026-08-22',
  },
})

const creerPiece = (quantity: number) => prisma.part.create({
  data: {
    garageId: ids.garage, name: 'Filtre à huile', reference: `REF-${quantity}-${Math.round(quantity * 7)}`,
    quantity, unitPriceTenThousandths: 120_000, unitCostTenThousandths: 60_000,
  },
})

/** Somme des deltas journalisés pour une pièce — le stock reconstitué. */
const deltasJournalises = async (partId: string) => {
  const mvts = await prisma.stockMovement.findMany({ where: { partId } })
  return mvts.reduce((s: number, m: any) => s + m.quantityDelta, 0)
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: partsPOST, DELETE: partsDELETE } = (await import('@/app/api/jobs/[id]/parts/route')) as any)
  ;({ DELETE: jobDELETE } = (await import('@/app/api/jobs/[id]/route')) as any)
  ;({ DELETE: invoiceDELETE } = (await import('@/app/api/invoices/[id]/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Stock', slug: 'garage-stock-trace' } })
  const mecano = await prisma.mechanic.create({ data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id } })
  ids.garage = garage.id; ids.mecano = mecano.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.emettrePendantLaTransaction = false
  await prisma.stockMovement.deleteMany({})
  await prisma.jobPart.deleteMany({})
  await prisma.job.deleteMany({})
  await prisma.jobTombstone.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.quote.deleteMany({})
  await prisma.part.deleteMany({})
})

describe('GF-028 — poser une pièce laisse une trace', () => {
  it('le décrément est journalisé, et le journal reconstitue le stock', async () => {
    const job = await creerJob()
    const piece = await creerPiece(10)

    expect((await poser(job.id, piece.id, 3)).status).toBe(201)

    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(7)

    const mvts = await prisma.stockMovement.findMany({ where: { partId: piece.id } })
    expect(mvts, 'le stock a baissé : le journal doit le dire').toHaveLength(1)
    expect(mvts[0].quantityDelta).toBe(-3)
    expect(mvts[0].garageId).toBe(ids.garage)
    expect(mvts[0].reason, 'la raison doit désigner l’intervention').toContain(job.id)
    expect(10 + (await deltasJournalises(piece.id))).toBe(7)
  })

  it('retirer la pièce journalise la restitution — mouvements symétriques', async () => {
    const job = await creerJob()
    const piece = await creerPiece(10)
    const ligne = await (await poser(job.id, piece.id, 4)).json()

    expect((await retirer(job.id, ligne.id)).status).toBe(200)

    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(10)
    const mvts = await prisma.stockMovement.findMany({ where: { partId: piece.id }, orderBy: { createdAt: 'asc' } })
    expect(mvts.map((m: any) => m.quantityDelta)).toEqual([-4, 4])
    expect(await deltasJournalises(piece.id), 'aller-retour : solde nul').toBe(0)
  })

  it('un stock INSUFFISANT n’écrit aucun mouvement', async () => {
    const job = await creerJob()
    const piece = await creerPiece(2)

    expect((await poser(job.id, piece.id, 5)).status).toBe(409)
    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(2)
    expect(
      await prisma.stockMovement.count({ where: { partId: piece.id } }),
      'un refus ne laisse pas de trace de mouvement',
    ).toBe(0)
  })

  it('SUPPRIMER l’intervention rend les pièces au stock, et le dit', async () => {
    const job = await creerJob()
    const piece = await creerPiece(10)
    await poser(job.id, piece.id, 6)
    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(4)

    const res = await jobDELETE(new Request('http://localhost/api/jobs/x', { method: 'DELETE' }), { params: { id: job.id } })
    expect(res.status).toBe(200)

    expect(
      (await prisma.part.findUnique({ where: { id: piece.id } })).quantity,
      'la cascade effaçait les JobPart : les pièces étaient perdues',
    ).toBe(10)
    expect(await deltasJournalises(piece.id), 'restitution comprise, le solde est nul').toBe(0)

    const restitution = await prisma.stockMovement.findFirst({
      where: { partId: piece.id, quantityDelta: 6 },
    })
    expect(restitution, 'la restitution doit être journalisée elle aussi').toBeTruthy()
    expect(restitution.reason).toContain(job.id)

    // L'intervention est bien partie, pierre tombale comprise.
    expect(await prisma.job.count({ where: { id: job.id } })).toBe(0)
    expect(await prisma.jobTombstone.count({ where: { jobId: job.id } })).toBe(1)
  })

  it('plusieurs pièces sur la même intervention sont TOUTES rendues', async () => {
    const job = await creerJob()
    const a = await creerPiece(10)
    const b = await creerPiece(20)
    await poser(job.id, a.id, 2)
    await poser(job.id, b.id, 5)

    await jobDELETE(new Request('http://localhost/api/jobs/x', { method: 'DELETE' }), { params: { id: job.id } })

    expect((await prisma.part.findUnique({ where: { id: a.id } })).quantity).toBe(10)
    expect((await prisma.part.findUnique({ where: { id: b.id } })).quantity).toBe(20)
  })

  it('une intervention d’un AUTRE garage ne rend rien chez nous', async () => {
    // La restitution est bornée au garage de la session, comme la suppression.
    const autre = await prisma.garage.create({ data: { name: 'Voisin', slug: 'voisin-stock' } })
    const mecanoB = await prisma.mechanic.create({ data: { name: 'Bob', avatar: 'BO', color: '#111', garageId: autre.id } })
    const jobB = await prisma.job.create({
      data: {
        garageId: autre.id, mechanicId: mecanoB.id, customerName: 'X', vehicleModel: 'C3',
        repairType: 'oil_change', estimatedDuration: 60, startTime: '09:00', date: '2026-08-22',
      },
    })

    const res = await jobDELETE(new Request('http://localhost/api/jobs/x', { method: 'DELETE' }), { params: { id: jobB.id } })
    expect(res.status, 'une intervention étrangère n’est pas supprimable').toBe(404)
    expect(await prisma.job.count({ where: { id: jobB.id } })).toBe(1)
    expect(
      await prisma.jobTombstone.count({ where: { jobId: jobB.id } }),
      'aucune pierre tombale sur un refus',
    ).toBe(0)

    await prisma.job.deleteMany({ where: { garageId: autre.id } })
    await prisma.mechanic.deleteMany({ where: { garageId: autre.id } })
    await prisma.garage.delete({ where: { id: autre.id } })
  })
})

describe('GF-029 — une facture émise entre-temps n’est plus effacée', () => {
  const creerFacture = (status: string) => prisma.invoice.create({
    data: {
      garageId: ids.garage, number: `FAC-2026-${status}`, clientName: 'Client Facture',
      status, issueDate: '2026-08-14',
    },
  })

  const supprimer = (id: string) =>
    invoiceDELETE(new Request('http://localhost/api/invoices/x', { method: 'DELETE' }), { params: { id } })

  it('un brouillon reste supprimable — le correctif ne bloque rien', async () => {
    const f = await creerFacture('draft')
    expect((await supprimer(f.id)).status).toBe(200)
    expect(await prisma.invoice.count({ where: { id: f.id } })).toBe(0)
  })

  it('une facture émise AVANT l’appel est refusée (contrôle existant)', async () => {
    const f = await creerFacture('sent')
    expect((await supprimer(f.id)).status).toBe(409)
    expect(await prisma.invoice.count({ where: { id: f.id } })).toBe(1)
  })

  it('émise PENDANT la transaction : refus, et rien n’est perdu', async () => {
    const f = await creerFacture('draft')
    h.emettrePendantLaTransaction = true

    const res = await supprimer(f.id)
    const corps = await res.json()

    expect(res.status, 'la course effaçait une facture émise').toBe(409)
    expect(corps.error).toMatch(/émise/i)
    expect(corps.error, 'aucun détail technique exposé (§83)').not.toMatch(/prisma|stack|Error:/i)

    const restante = await prisma.invoice.findUnique({ where: { id: f.id } })
    expect(restante, 'la facture doit survivre à la course').toBeTruthy()
    expect(restante.number, 'son numéro de série reste pris').toBe(f.number)
  })

  it('le devis source n’est PAS déconverti quand la suppression échoue', async () => {
    // La remise du devis à « accepted » précède la suppression dans la même
    // transaction : si celle-ci est annulée, le devis doit revenir à
    // « converted ». Sinon un devis se retrouvait déconverti alors que sa
    // facture existe toujours.
    const f = await creerFacture('draft')
    const devis = await prisma.quote.create({
      data: {
        garageId: ids.garage, number: 'DEV-2026-001', clientName: 'Client Facture',
        status: 'converted', invoiceId: f.id, issueDate: '2026-08-14',
      },
    })
    h.emettrePendantLaTransaction = true

    expect((await supprimer(f.id)).status).toBe(409)

    const apres = await prisma.quote.findUnique({ where: { id: devis.id } })
    expect(apres.status, 'la transaction annulée doit tout annuler').toBe('converted')
    expect(apres.invoiceId).toBe(f.id)
  })
})

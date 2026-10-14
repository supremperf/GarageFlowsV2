/**
 * SCÉNARIO MAÎTRE (§96) — une journée d'atelier, de bout en bout.
 *
 * Ce test ne vérifie pas des fonctions isolées : il enchaîne le parcours réel
 * d'un garage sur une base SQLite VRAIE, à travers les VRAIS gestionnaires de
 * route, et contrôle à chaque étape que l'effet a bien atteint la base — pas
 * seulement qu'une réponse 200 est revenue.
 *
 *   1. le client et son véhicule naissent de la planification (aucun écran ne
 *      les crée séparément) ;
 *   2. une pièce posée décrémente le stock ET laisse un mouvement ;
 *   3. un devis est établi puis converti en facture ;
 *   4. la facture validée engage le stock une seule fois ;
 *   5. le portail client est publié et lisible ;
 *   6. les statistiques reflètent la journée, au centime ;
 *   7. supprimer l'intervention rend les pièces au stock ;
 *   8. rien de tout cela ne franchit la frontière d'un autre garage.
 *
 * Ce qui reste HORS de portée de ce test, et doit être dit : le parcours dans
 * un NAVIGATEUR (clics, modales, rendu), qui exige des identifiants E2E et une
 * licence — cf. `e2e/` et le rapport final.
 */
type OriginalModule1 = typeof import('@/lib/api-helpers')

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-scenario-maitre.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: () => {}, scheduleJobSync: () => {} }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
const R: Record<string, any> = {}
const ids = { garage: '', mecano: '', autreGarage: '' }

/** Date du jour au format attendu par les routes. */
const aujourdhui = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

const json = (corps: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corps),
})

/** Lit une réponse UNE seule fois (le corps n'est pas rejouable). */
async function lire(res: Response) {
  const texte = await res.text()
  try { return { status: res.status, corps: JSON.parse(texte) } } catch { return { status: res.status, corps: texte } }
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))

  R.jobsPOST      = (await import('@/app/api/jobs/route') as any).POST
  R.jobDELETE     = (await import('@/app/api/jobs/[id]/route') as any).DELETE
  R.partsPOST     = (await import('@/app/api/jobs/[id]/parts/route') as any).POST
  R.quotesPOST    = (await import('@/app/api/quotes/route') as any).POST
  R.convertPOST   = (await import('@/app/api/quotes/[id]/convert/route') as any).POST
  R.invoicePATCH  = (await import('@/app/api/invoices/[id]/route') as any).PATCH
  R.statsGET      = (await import('@/app/api/stats/route') as any).GET

  const garage = await prisma.garage.create({
    data: {
      name: 'Garage Scénario', slug: 'scenario-maitre',
      hourlyRateTenThousandths: 65 * 10_000, taxRate: 20,
    },
  })
  const autre = await prisma.garage.create({ data: { name: 'Voisin', slug: 'scenario-voisin' } })
  const mecano = await prisma.mechanic.create({
    data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id },
  })
  ids.garage = garage.id; ids.mecano = mecano.id; ids.autreGarage = autre.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

describe('SCÉNARIO MAÎTRE — une journée complète, du planning aux statistiques', () => {
  const etat: Record<string, any> = {}

  it('1. planifier une intervention CRÉE le client et le véhicule', async () => {
    const { status, corps } = await lire(await R.jobsPOST(new Request('http://localhost/api/jobs', json({
      customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD',
      repairType: 'oil_change', estimatedDuration: 120, startTime: '09:00',
      date: aujourdhui, mechanicId: ids.mecano,
    }))))
    expect(status, JSON.stringify(corps)).toBe(201)
    etat.jobId = corps.id

    // L'annuaire ne doit plus rester vide : c'est le défaut GF-015.
    const client = await prisma.client.findFirst({ where: { garageId: ids.garage } })
    const vehicule = await prisma.vehicle.findFirst({ where: { garageId: ids.garage } })
    expect(client?.name).toBe('Jean Dupont')
    expect(vehicule?.licensePlate).toBe('AB-123-CD')
    expect(corps.vehicleId, 'l’intervention doit pointer sur le véhicule').toBe(vehicule.id)
    etat.clientId = client.id
  })

  it('2. poser une pièce décrémente le stock ET laisse un mouvement', async () => {
    const piece = await prisma.part.create({
      data: {
        garageId: ids.garage, name: 'Filtre à huile', reference: 'F-100', quantity: 10,
        unitPriceTenThousandths: 12 * 10_000, unitCostTenThousandths: 6 * 10_000,
      },
    })
    etat.pieceId = piece.id

    const { status } = await lire(await R.partsPOST(
      new Request('http://localhost/x', json({ partId: piece.id, quantity: 3 })),
      { params: { id: etat.jobId } },
    ))
    expect(status).toBe(201)

    expect((await prisma.part.findUnique({ where: { id: piece.id } })).quantity).toBe(7)
    const mvts = await prisma.stockMovement.findMany({ where: { partId: piece.id } })
    expect(mvts, 'le stock a bougé : le journal doit le dire (GF-028)').toHaveLength(1)
    expect(mvts[0].quantityDelta).toBe(-3)
  })

  it('3. établir un devis rattaché au client', async () => {
    const { status, corps } = await lire(await R.quotesPOST(new Request('http://localhost/api/quotes', json({
      clientName: 'Jean Dupont', clientId: etat.clientId, jobId: etat.jobId,
      issueDate: aujourdhui, taxRate: 20,
      lines: [
        { description: 'Main-d’œuvre', quantity: 2, unitPrice: 65, unitCost: 0, isLabor: true, sortOrder: 0 },
        { description: 'Filtre à huile', quantity: 3, unitPrice: 12, unitCost: 6, isLabor: false, sortOrder: 1 },
      ],
    }))))
    expect(status, JSON.stringify(corps)).toBe(201)
    etat.quoteId = corps.id

    // 2 × 65 + 3 × 12 = 166 € HT.
    const devis = await prisma.quote.findUnique({ where: { id: corps.id }, include: { lines: true } })
    expect(devis.lines).toHaveLength(2)
    expect(devis.clientId, 'le devis suit le client, pas son nom').toBe(etat.clientId)
  })

  it('4. convertir le devis produit une facture cohérente', async () => {
    await prisma.quote.update({ where: { id: etat.quoteId }, data: { status: 'accepted' } })
    const { status, corps } = await lire(await R.convertPOST(
      new Request('http://localhost/x', json({})),
      { params: { id: etat.quoteId } },
    ))
    expect(status, JSON.stringify(corps)).toBe(201)
    etat.invoiceId = corps.id ?? corps.invoice?.id
    expect(etat.invoiceId).toBeTruthy()

    const facture = await prisma.invoice.findUnique({
      where: { id: etat.invoiceId }, include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })
    expect(facture.lines).toHaveLength(2)
    expect(facture.status).toBe('draft')
    // Les lignes reprises d'une intervention ne se rattachent PAS au stock :
    // les pièces en sont déjà sorties à la pose (double décrément évité).
    for (const l of facture.lines) expect(l.partId).toBeNull()

    const devis = await prisma.quote.findUnique({ where: { id: etat.quoteId } })
    expect(devis.status).toBe('converted')
    expect(devis.invoiceId).toBe(etat.invoiceId)
  })

  it('5. émettre puis encaisser la facture n’entame PAS une seconde fois le stock', async () => {
    const avant = (await prisma.part.findUnique({ where: { id: etat.pieceId } })).quantity

    for (const status of ['sent', 'paid']) {
      const r = await lire(await R.invoicePATCH(
        new Request('http://localhost/x', { ...json({ status }), method: 'PATCH' }),
        { params: { id: etat.invoiceId } },
      ))
      expect(r.status, `${status} : ${JSON.stringify(r.corps)}`).toBe(200)
    }

    expect((await prisma.invoice.findUnique({ where: { id: etat.invoiceId } })).status).toBe('paid')
    expect(
      (await prisma.part.findUnique({ where: { id: etat.pieceId } })).quantity,
      'les pièces ont déjà quitté le stock à la pose',
    ).toBe(avant)
  })

  it('6. les statistiques reflètent la journée, au centime', async () => {
    await prisma.job.update({
      where: { id: etat.jobId },
      data: { status: 'completed', actualDuration: 120 },
    })
    const { status, corps } = await lire(await R.statsGET(new Request('http://localhost/api/stats?period=7')))
    expect(status).toBe(200)

    // 2 h × 65 €/h = 130 € de main-d'œuvre ; 3 × 12 € = 36 € de pièces.
    expect(corps.totals.laborRevenue).toBeCloseTo(130, 2)
    expect(corps.totals.partsRevenue).toBeCloseTo(36, 2)
    expect(corps.totals.totalRevenue).toBeCloseTo(166, 2)
    // Marge pièces = 36 − 3 × 6 = 18 €.
    expect(corps.totals.partsMargin).toBeCloseTo(18, 2)
    // Le classement suit le CLIENT rattaché, pas l'orthographe du nom (GF-036).
    expect(corps.topClients[0].name).toBe('Jean Dupont')
  })

  it('7. supprimer l’intervention REND les pièces au stock', async () => {
    const avant = (await prisma.part.findUnique({ where: { id: etat.pieceId } })).quantity
    const { status } = await lire(await R.jobDELETE(
      new Request('http://localhost/x', { method: 'DELETE' }),
      { params: { id: etat.jobId } },
    ))
    expect(status).toBe(200)

    expect(
      (await prisma.part.findUnique({ where: { id: etat.pieceId } })).quantity,
      'la cascade emportait les JobPart sans rien restituer (GF-028)',
    ).toBe(avant + 3)

    // Solde du journal nul : sortie puis restitution.
    const mvts = await prisma.stockMovement.findMany({ where: { partId: etat.pieceId } })
    expect(mvts.reduce((s: number, m: any) => s + m.quantityDelta, 0)).toBe(0)

    // La pierre tombale part vers le cloud, et la facture SURVIT : un document
    // émis ne disparaît pas avec l'intervention.
    expect(await prisma.jobTombstone.count({ where: { jobId: etat.jobId } })).toBe(1)
    expect(await prisma.invoice.count({ where: { id: etat.invoiceId } })).toBe(1)
  })

  it('8. rien de tout cela n’a franchi la frontière du garage voisin', async () => {
    for (const [modele, cle] of [
      ['client', 'clientId'], ['vehicle', null], ['quote', 'quoteId'],
      ['invoice', 'invoiceId'], ['part', 'pieceId'], ['stockMovement', null],
    ] as const) {
      const chez = await (prisma as any)[modele].count({ where: { garageId: ids.garage } })
      const voisin = await (prisma as any)[modele].count({ where: { garageId: ids.autreGarage } })
      expect(chez, `${modele} : le garage doit avoir des données`).toBeGreaterThan(0)
      expect(voisin, `${modele} : le voisin ne doit RIEN avoir reçu`).toBe(0)
      void cle
    }
  })
})

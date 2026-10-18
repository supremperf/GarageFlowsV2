/**
 * POST /api/sync/invoice — publication POSTE → CLOUD des factures.
 *
 * Base RÉELLE (SQLite depuis le schéma) : la contrainte `@@unique([garageId,
 * number])`, le remplacement transactionnel des lignes et l'absence de doublon
 * ne se prouvent pas dans une carte en mémoire.
 *
 * Ce qui est le plus important ici n'est pas qu'une facture arrive, c'est que le
 * cloud NE TOUCHE PAS AU STOCK : l'inventaire appartient au poste, et deux
 * décréments pour une seule vente seraient la pire des régressions.
 *
 * RÉSERVE : la production cloud tourne sur PostgreSQL. Ses sémantiques de
 * transaction sont plus strictes, pas moins — mais elles restent `NOT_VERIFIED`
 * tant qu'un PostgreSQL réel n'a pas rejoué ces cas (TEST_POSTGRES_URL absent).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-invoice.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ garageId: '', code: null as string | null }))

vi.mock('@/lib/sync/garage-auth', () => ({
  shortId: (s: string) => String(s).slice(0, 8),
  authenticateGarageLicense: async () =>
    h.code ? { ok: false, code: h.code } : { ok: true, garageId: h.garageId, licenseId: 'lid-1' },
}))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  clientIpFrom: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}))

let prisma: any
let POST: (req: Request) => Promise<Response>
const ids = { garageA: '', garageB: '', piece: '' }
const FACTURE = 'facture-poste-1'

const ligne = (over: Record<string, unknown> = {}) => ({
  id: 'il-1', description: 'Plaquettes avant', quantityTenThousandths: 20_000,
  unitPriceTenThousandths: 455_000, unitCostTenThousandths: 210_000,
  isLabor: false, sortOrder: 0, ...over,
})

const charge = (over: Record<string, unknown> = {}, lignes?: unknown[]) => ({
  garageLicense: 'GF2.peu-importe',
  invoices: [{
    id: FACTURE, number: 'FAC-2026-001', status: 'sent', issueDate: '2026-08-15',
    clientName: 'Client Test', vehicleModel: 'Clio III', licensePlate: 'AA-123-BB',
    taxRate: 20, lines: lignes ?? [ligne()], ...over,
  }],
})

const publier = (body: unknown) =>
  POST(new Request('http://localhost/api/sync/invoice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/invoice/route')) as any)

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'inv-a' } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'inv-b' } })
  ids.garageA = a.id
  ids.garageB = b.id
  const piece = await prisma.part.create({
    data: { garageId: a.id, name: 'Plaquettes', reference: 'PLQ-1', quantity: 10 },
  })
  ids.piece = piece.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.garageA
  h.code = null
  await prisma.stockMovement.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.part.update({ where: { id: ids.piece }, data: { quantity: 10 } })
})

describe('l’inventaire appartient au POSTE', () => {
  it('publier une facture ne crée AUCUN mouvement de stock', async () => {
    await publier(charge({ stockCommittedAt: '2026-08-15T09:00:00.000Z' }))
    expect(await prisma.stockMovement.count({}), 'le cloud n’est pas un second comptable').toBe(0)
  })

  it('publier une facture ne décrémente AUCUNE pièce', async () => {
    await publier(charge({ stockCommittedAt: '2026-08-15T09:00:00.000Z' }))
    const piece = await prisma.part.findUnique({ where: { id: ids.piece } })
    expect(piece.quantity, 'deux décréments pour une vente seraient la pire régression').toBe(10)
  })

  it('la ligne ne garde AUCUN lien vers une pièce non publiée', async () => {
    await publier(charge({}, [ligne({ partId: ids.piece })]))
    const [l] = await prisma.invoiceLine.findMany({ where: { invoiceId: FACTURE } })
    expect(l.partId, 'une clé étrangère pendante casserait la contrainte').toBeNull()
    // …mais la désignation reste : c'est elle que le client lit.
    expect(l.description).toBe('Plaquettes avant')
  })

  it('l’engagement du stock est recopié tel quel — c’est un fait daté', async () => {
    await publier(charge({ stockCommittedAt: '2026-08-15T09:00:00.000Z' }))
    const f = await prisma.invoice.findUnique({ where: { id: FACTURE } })
    expect(f.stockCommittedAt, 'le masquer laisserait croire qu’aucun stock n’a été engagé').toBeTruthy()
    expect(new Date(f.stockCommittedAt).toISOString()).toBe('2026-08-15T09:00:00.000Z')
  })
})

describe('écriture et montants', () => {
  it('crée la facture sous l’identifiant du poste', async () => {
    const res = await publier(charge())
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.applied).toEqual([FACTURE])

    const f = await prisma.invoice.findUnique({ where: { id: FACTURE } })
    expect(f.garageId).toBe(ids.garageA)
    expect(f.number).toBe('FAC-2026-001')
    expect(f.clientId, 'fiche client non publiée').toBeNull()
  })

  it('recopie les montants ENTIERS sans les recalculer', async () => {
    await publier(charge())
    const [l] = await prisma.invoiceLine.findMany({ where: { invoiceId: FACTURE } })
    // 2 × 45,50 € — au dix-millième près, tel que le poste l'a enregistré.
    expect(l.quantityTenThousandths).toBe(20_000)
    expect(l.unitPriceTenThousandths).toBe(455_000)
    expect(l.unitCostTenThousandths).toBe(210_000)
  })
})

describe('idempotence', () => {
  it('republier NE CRÉE PAS une seconde facture', async () => {
    await publier(charge())
    await publier(charge())
    expect(await prisma.invoice.count({ where: { garageId: ids.garageA } })).toBe(1)
  })

  it('une ligne SUPPRIMÉE sur le poste disparaît de la facture publiée', async () => {
    await publier(charge({}, [ligne(), ligne({ id: 'il-2', description: 'Main d’œuvre', isLabor: true, sortOrder: 1 })]))
    expect(await prisma.invoiceLine.count({ where: { invoiceId: FACTURE } })).toBe(2)

    await publier(charge({}, [ligne()]))
    const restantes = await prisma.invoiceLine.findMany({ where: { invoiceId: FACTURE } })
    expect(restantes).toHaveLength(1)
    expect(restantes[0].description).toBe('Plaquettes avant')
  })
})

describe('refus', () => {
  it('une facture d’un AUTRE garage n’est jamais écrasée', async () => {
    await publier(charge())
    h.garageId = ids.garageB
    const res = await publier(charge({ clientName: 'Intrus' }))
    const corps = await res.json()
    expect(corps.rejected).toEqual([{ id: FACTURE, code: 'INVOICE_FOREIGN_GARAGE' }])

    const f = await prisma.invoice.findUnique({ where: { id: FACTURE } })
    expect(f.garageId).toBe(ids.garageA)
    expect(f.clientName, 'aucune donnée du garage B ne s’est écrite').toBe('Client Test')
  })

  it('un numéro déjà pris par une AUTRE facture est refusé explicitement', async () => {
    await publier(charge())
    const res = await publier(charge({ id: 'autre-facture' }))
    const corps = await res.json()
    expect(corps.rejected[0].code).toBe('INVOICE_NUMBER_TAKEN')
    expect(await prisma.invoice.count({ where: { garageId: ids.garageA } })).toBe(1)
  })

  it('un refus n’empêche pas les AUTRES factures du lot de passer', async () => {
    const lot = charge()
    lot.invoices.push({
      id: 'facture-2', number: 'FAC-2026-002', status: 'sent', issueDate: '2026-08-15',
      clientName: 'Client 2', taxRate: 20, lines: [],
    } as never)
    ;(lot.invoices[0] as any).number = ''   // première facture invalide
    const res = await publier(lot)
    const corps = await res.json()
    expect(corps.rejected[0].code).toBe('BAD_REQUEST')
    expect(corps.applied, 'un lot ne doit pas être perdu pour une ligne fautive').toEqual(['facture-2'])
  })

  it('le garageId vient de la LICENCE, jamais du corps', async () => {
    await publier({ ...charge(), garageId: ids.garageB })
    const f = await prisma.invoice.findUnique({ where: { id: FACTURE } })
    expect(f.garageId).toBe(ids.garageA)
  })

  it('une licence refusée ne laisse rien s’écrire', async () => {
    h.code = 'LICENSE_REVOKED'
    const res = await publier(charge())
    expect(res.status).toBe(403)
    expect(await prisma.invoice.count({})).toBe(0)
  })
})

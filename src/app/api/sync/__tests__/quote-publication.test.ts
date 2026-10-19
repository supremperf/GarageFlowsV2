/**
 * POST /api/sync/quote — publication POSTE → CLOUD d'un devis.
 *
 * Contrairement aux autres tests de cette famille, la base n'est PAS simulée :
 * on exerce une vraie base SQLite construite depuis le schéma. C'est délibéré —
 * ce qui doit être prouvé ici est justement ce qu'une carte en mémoire ne sait
 * pas reproduire : la contrainte `@@unique([garageId, number])`, le remplacement
 * transactionnel des lignes, et l'absence de doublon à la republication.
 *
 * RÉSERVE : la production tourne sur PostgreSQL. Les sémantiques de transaction
 * et de contrainte y sont plus strictes, pas moins — mais elles restent
 * `NOT_VERIFIED` tant qu'un PostgreSQL réel n'a pas rejoué ces cas
 * (TEST_POSTGRES_URL absent de cet environnement).
 *
 * Seule l'AUTHENTIFICATION est simulée : elle a ses propres tests, et fabriquer
 * une licence GF2 signée ici n'éprouverait rien de ce que cette route apporte.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-quote.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-de-test-publication-devis-0123456789abcdef'

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
const ids = { garageA: '', garageB: '' }

const DEVIS = 'devis-poste-1'

const charge = (over: Record<string, unknown> = {}, lignes?: unknown[]) => ({
  garageLicense: 'GF2.peu-importe',
  quote: {
    id: DEVIS, number: 'DEV-2026-001', status: 'draft', issueDate: '2026-08-15',
    clientName: 'Client Test', clientEmail: 'client@example.test',
    vehicleModel: 'Clio III', licensePlate: 'AA-123-BB', taxRate: 20,
    ...over,
  },
  lines: lignes ?? [{
    id: 'l1', description: 'Vidange', quantityTenThousandths: 10_000,
    unitPriceTenThousandths: 900_000, unitCostTenThousandths: 400_000,
    isLabor: true, sortOrder: 0,
  }],
})

const publier = (body: unknown) =>
  POST(new Request('http://localhost/api/sync/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/quote/route')) as any)

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'garage-a' } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'garage-b' } })
  ids.garageA = a.id
  ids.garageB = b.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.garageA
  h.code = null
  await prisma.quoteLine.deleteMany({})
  await prisma.quote.deleteMany({})
})

describe('publication d’un devis — écriture', () => {
  it('crée le devis avec l’IDENTIFIANT DU POSTE et rend un lien', async () => {
    const res = await publier(charge())
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.ok).toBe(true)
    expect(corps.url, 'le lien doit pointer sur le portail public').toMatch(/\/clients\/quote\//)
    expect(corps.expiresAt).toBeTruthy()

    // L'identifiant du poste devient l'identifiant cloud : aucune table de
    // correspondance, aucune corrélation par nom ou plaque.
    const devis = await prisma.quote.findUnique({ where: { id: DEVIS } })
    expect(devis, 'le devis doit exister sous SON identifiant').toBeTruthy()
    expect(devis.garageId).toBe(ids.garageA)
    expect(devis.number).toBe('DEV-2026-001')
  })

  it('recopie les montants ENTIERS sans les recalculer', async () => {
    await publier(charge())
    const [ligne] = await prisma.quoteLine.findMany({ where: { quoteId: DEVIS } })
    expect(ligne.unitPriceTenThousandths).toBe(900_000)
    expect(ligne.quantityTenThousandths).toBe(10_000)
    expect(ligne.unitCostTenThousandths).toBe(400_000)
  })

  it('ne publie NI client NI véhicule : les clés étrangères restent nulles', async () => {
    await publier(charge())
    const devis = await prisma.quote.findUnique({ where: { id: DEVIS } })
    expect(devis.clientId, 'une clé pendante casserait la contrainte').toBeNull()
    expect(devis.vehicleId).toBeNull()
    // …mais l'instantané nécessaire à l'affichage est bien là.
    expect(devis.clientName).toBe('Client Test')
    expect(devis.licensePlate).toBe('AA-123-BB')
  })
})

describe('publication d’un devis — idempotence', () => {
  it('republier NE CRÉE PAS un second devis', async () => {
    await publier(charge())
    await publier(charge())
    const tous = await prisma.quote.findMany({ where: { garageId: ids.garageA } })
    expect(tous, 'un double envoi ne doit pas dupliquer').toHaveLength(1)
  })

  it('republier MET À JOUR le devis existant', async () => {
    await publier(charge())
    await publier(charge({ clientName: 'Client Corrigé', status: 'sent' }))
    const devis = await prisma.quote.findUnique({ where: { id: DEVIS } })
    expect(devis.clientName).toBe('Client Corrigé')
    expect(devis.status).toBe('sent')
  })

  it('une ligne SUPPRIMÉE sur le poste disparaît du devis publié', async () => {
    await publier(charge({}, [
      { id: 'l1', description: 'Vidange', quantityTenThousandths: 10_000, unitPriceTenThousandths: 900_000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 0 },
      { id: 'l2', description: 'Filtre', quantityTenThousandths: 10_000, unitPriceTenThousandths: 150_000, unitCostTenThousandths: 0, isLabor: false, sortOrder: 1 },
    ]))
    expect(await prisma.quoteLine.count({ where: { quoteId: DEVIS } })).toBe(2)

    await publier(charge({}, [
      { id: 'l1', description: 'Vidange', quantityTenThousandths: 10_000, unitPriceTenThousandths: 900_000, unitCostTenThousandths: 0, isLabor: true, sortOrder: 0 },
    ]))
    const restantes = await prisma.quoteLine.findMany({ where: { quoteId: DEVIS } })
    expect(restantes, 'la ligne retirée ne doit pas survivre chez le client').toHaveLength(1)
    expect(restantes[0].description).toBe('Vidange')
  })
})

describe('publication d’un devis — refus', () => {
  it('un devis appartenant à un AUTRE garage n’est jamais écrasé', async () => {
    // Garage A publie.
    await publier(charge())
    // Garage B tente de republier le MÊME identifiant.
    h.garageId = ids.garageB
    const res = await publier(charge({ clientName: 'Intrus' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('QUOTE_FOREIGN_GARAGE')

    const devis = await prisma.quote.findUnique({ where: { id: DEVIS } })
    expect(devis.garageId, 'le devis reste au garage A').toBe(ids.garageA)
    expect(devis.clientName, 'aucune donnée du garage B ne s’est écrite').toBe('Client Test')
  })

  it('un numéro déjà pris par un AUTRE devis est refusé explicitement', async () => {
    await publier(charge())
    const res = await publier(charge({ id: 'autre-devis' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('QUOTE_NUMBER_TAKEN')
    expect(await prisma.quote.count({ where: { garageId: ids.garageA } })).toBe(1)
  })

  it('un devis déjà accepté ou converti ne se republie pas', async () => {
    for (const status of ['accepted', 'refused', 'converted']) {
      const res = await publier(charge({ status }))
      expect(res.status, `statut ${status}`).toBe(409)
      expect((await res.json()).code).toBe('QUOTE_NOT_SIGNABLE')
    }
    expect(await prisma.quote.count({})).toBe(0)
  })

  it('le garageId vient de la LICENCE, jamais du corps de la requête', async () => {
    const res = await publier({ ...charge(), garageId: ids.garageB })
    expect(res.status).toBe(200)
    const devis = await prisma.quote.findUnique({ where: { id: DEVIS } })
    expect(devis.garageId, 'un champ libre ne doit pas choisir le garage').toBe(ids.garageA)
  })

  it('une licence refusée ne laisse rien s’écrire', async () => {
    h.code = 'LICENSE_REVOKED'
    const res = await publier(charge())
    expect(res.status).toBe(403)
    expect(await prisma.quote.count({})).toBe(0)
  })
})

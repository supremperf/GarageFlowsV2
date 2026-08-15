/**
 * GF-036 — les chiffres du tableau de bord dérivaient, et se contredisaient.
 *
 * ─── Trois défauts d'une même famille ───────────────────────────────────────
 * 1. `GET /api/stats` arrondissait chaque JOURNÉE à l'euro (`Math.round`) puis
 *    additionnait les journées. Sept jours à 1 h 30 × 65 €/h font 682,50 €
 *    réels ; arrondis jour par jour (98 €), ils en font 686. Sur la fenêtre
 *    maximale de 90 jours, la dérive atteint ±45 €. `lib/money` pose pourtant
 *    la règle inverse : entiers de centimes, arrondi EN DERNIER.
 *
 * 2. `confirmedRevenue` promettait en commentaire « max(job-based,
 *    invoice-based) » et écrivait un ternaire — qui comparait au surplus le
 *    TTC des factures payées au HT du planning. Une seule facture encaissée
 *    faisait disparaître la branche « planning ».
 *
 * 3. Le classement des meilleurs clients agrégeait sur `customerName`, du
 *    texte libre ressaisi à chaque intervention : « Jean Dupont », « jean
 *    dupont » et la fiche client renommée comptaient pour trois personnes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-stats-centime.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
let statsGET: (req: Request) => Promise<Response>
const ids = { garage: '', mecano: '' }

/** Le taux horaire est enregistré en dix-millièmes d'euro. */
const TARIF_HORAIRE = 65

const lireStats = async (jours: number) => {
  const res = await statsGET(new Request(`http://localhost/api/stats?period=${jours}`))
  const texte = await res.text()
  expect(res.status, texte).toBe(200)
  return JSON.parse(texte)
}

/** Date ISO à `n` jours avant aujourd'hui. */
const ilYA = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: statsGET } = (await import('@/app/api/stats/route')) as any)

  const garage = await prisma.garage.create({
    data: {
      name: 'Garage Stats', slug: 'garage-stats-centime',
      hourlyRateTenThousandths: TARIF_HORAIRE * 10_000,
    },
  })
  const mecano = await prisma.mechanic.create({
    data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id },
  })
  ids.garage = garage.id; ids.mecano = mecano.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  await prisma.jobPart.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.job.deleteMany({})
  await prisma.vehicle.deleteMany({})
  await prisma.client.deleteMany({})
  await prisma.part.deleteMany({})
})

/** Intervention TERMINÉE de `minutes`, datée d'il y a `jours`. */
const interventionTerminee = (jours: number, minutes: number, client = 'Client') =>
  prisma.job.create({
    data: {
      garageId: ids.garage, mechanicId: ids.mecano, customerName: client,
      vehicleModel: 'Clio', repairType: 'oil_change',
      estimatedDuration: minutes, actualDuration: minutes,
      startTime: '09:00', date: ilYA(jours), status: 'completed',
    },
  })

describe('GF-036 — le cumul se fait au centime', () => {
  it('sept journées de 1 h 30 font 682,50 €, pas 686 €', async () => {
    // 1,5 h × 65 €/h = 97,50 € par jour. Arrondi journalier → 98 € × 7 = 686 €.
    for (let j = 1; j <= 7; j++) await interventionTerminee(j, 90)

    const stats = await lireStats(30)
    expect(
      stats.totals.laborRevenue,
      'l’arrondi journalier gonflait le cumul de 3,50 € en une semaine',
    ).toBeCloseTo(682.5, 2)
  })

  it('chaque journée porte le montant EXACT, pas un euro rond', async () => {
    await interventionTerminee(1, 90)
    const stats = await lireStats(30)
    const jour = stats.dailyStats.find((d: any) => d.laborRevenue > 0)
    expect(jour.laborRevenue).toBeCloseTo(97.5, 2)
  })

  it('une marge pièces de moins d’un euro ne disparaît plus', async () => {
    // Produit 100,40 € / coût 99,60 € : les deux s'arrondissaient au même euro,
    // et une marge réelle de 0,80 € s'évaporait.
    const piece = await prisma.part.create({
      data: {
        garageId: ids.garage, name: 'Filtre', reference: 'F-1', quantity: 10,
        unitPriceTenThousandths: 100_4000, unitCostTenThousandths: 99_6000,
      },
    })
    const job = await interventionTerminee(1, 60)
    await prisma.jobPart.create({
      data: {
        jobId: job.id, partId: piece.id, quantity: 1,
        unitPriceTenThousandths: 100_4000, unitCostTenThousandths: 99_6000,
      },
    })

    const stats = await lireStats(30)
    expect(stats.totals.partsMargin).toBeCloseTo(0.8, 2)
  })

  it('aucune intervention : tout reste à zéro, sans NaN', async () => {
    const stats = await lireStats(30)
    expect(stats.totals.laborRevenue).toBe(0)
    expect(stats.totals.totalRevenue).toBe(0)
    expect(Number.isNaN(stats.totals.partsMargin)).toBe(false)
  })
})

describe('GF-036 — `confirmedRevenue` compare enfin deux grandeurs HT', () => {
  it('une facture payée n’efface plus l’activité de l’atelier', async () => {
    // 10 journées de 2 h = 1 300 € d'activité, contre une facture de 12 €.
    for (let j = 1; j <= 10; j++) await interventionTerminee(j, 120)
    const facture = await prisma.invoice.create({
      data: {
        garageId: ids.garage, number: 'FAC-2026-CR', clientName: 'X',
        status: 'paid', issueDate: ilYA(1), taxRate: 20,
      },
    })
    await prisma.invoiceLine.create({
      data: {
        invoiceId: facture.id, description: 'Broutille', sortOrder: 0,
        quantityTenThousandths: 1 * 10_000, unitPriceTenThousandths: 10 * 10_000,
      },
    })

    const stats = await lireStats(30)
    expect(stats.totals.totalRevenue).toBeCloseTo(1300, 2)
    expect(
      stats.totals.confirmedRevenue,
      'le ternaire faisait tomber 1 300 € d’activité à 12 €',
    ).toBe(1300)
  })

  it('une grosse facture l’emporte sur un planning vide', async () => {
    const facture = await prisma.invoice.create({
      data: {
        garageId: ids.garage, number: 'FAC-2026-GR', clientName: 'X',
        status: 'paid', issueDate: ilYA(1), taxRate: 20,
      },
    })
    await prisma.invoiceLine.create({
      data: {
        invoiceId: facture.id, description: 'Réfection moteur', sortOrder: 0,
        quantityTenThousandths: 1 * 10_000, unitPriceTenThousandths: 2000 * 10_000,
      },
    })

    const stats = await lireStats(30)
    expect(stats.totals.confirmedRevenue, 'HT, pas TTC').toBe(2000)
  })
})

describe('GF-036 — le classement suit le client, pas l’orthographe', () => {
  it('trois graphies d’un même client rattaché ne font qu’une entrée', async () => {
    const client = await prisma.client.create({ data: { garageId: ids.garage, name: 'Jean Dupont' } })
    const vehicule = await prisma.vehicle.create({
      data: {
        garageId: ids.garage, clientId: client.id,
        licensePlate: 'AB-123-CD', make: 'Renault', model: 'Clio',
      },
    })
    for (const graphie of ['Jean Dupont', 'jean dupont', 'J. Dupont']) {
      await prisma.job.create({
        data: {
          garageId: ids.garage, mechanicId: ids.mecano, customerName: graphie,
          vehicleId: vehicule.id, vehicleModel: 'Clio', repairType: 'oil_change',
          estimatedDuration: 60, actualDuration: 60, startTime: '09:00',
          date: ilYA(2), status: 'completed',
        },
      })
    }

    const stats = await lireStats(30)
    expect(stats.topClients, 'trois graphies = un seul client').toHaveLength(1)
    expect(stats.topClients[0].count).toBe(3)
    expect(stats.topClients[0].name, 'le nom de la FICHE fait foi').toBe('Jean Dupont')
  })

  it('sans plaque, le repli sur le nom reste — et tolère la casse', async () => {
    await interventionTerminee(2, 60, 'Marie Martin')
    await interventionTerminee(3, 60, 'marie martin')

    const stats = await lireStats(30)
    expect(stats.topClients).toHaveLength(1)
    expect(stats.topClients[0].count).toBe(2)
  })

  it('deux clients DIFFÉRENTS restent deux entrées', async () => {
    await interventionTerminee(2, 60, 'Marie Martin')
    await interventionTerminee(3, 60, 'Paul Durand')

    const stats = await lireStats(30)
    expect(stats.topClients).toHaveLength(2)
  })
})

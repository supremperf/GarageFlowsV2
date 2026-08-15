/**
 * GF-011 — le planning tronquait la journée à 20 interventions, en silence.
 *
 * `GET /api/jobs` applique une pagination dont le défaut valait 20. Le magasin
 * du planning (`schedule-store.fetchData` / `refreshAll`) et le tableau de
 * réception appellent `/api/jobs?date=…` SANS `limit`, et n'utilisent que
 * `data` — jamais `total`. Au-delà de vingt interventions, les suivantes (les
 * plus tardives, le tri étant date puis heure croissantes) n'existaient donc
 * pour aucun écran du poste : ni planning, ni comptoir, aucun message.
 *
 * Deux surfaces du même produit ne montraient pas la même journée : le
 * mécanicien affecté, lui, voyait ces interventions dans sa PWA (limite 200).
 * Et l'empreinte `/api/jobs/pulse` comptant TOUTES les interventions, l'écran se
 * rechargeait pour retronquer aussitôt.
 *
 * Une requête `?date=` n'est pas une liste qu'on feuillette : c'est le contenu
 * d'un écran. Son défaut est désormais un plafond de sécurité, pas une page.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-planning-journee.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
// La remontée cloud n'est pas le sujet ici (et ne doit pas partir en test).
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: () => {}, scheduleJobSync: () => {} }))

let prisma: any
let jobsGET: (req: Request) => Promise<Response>
const JOUR = '2026-08-20'
const NB = 24

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: jobsGET } = (await import('@/app/api/jobs/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Chargé', slug: 'garage-charge' } })
  const mecano = await prisma.mechanic.create({ data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id } })
  // Vingt-quatre interventions sur la MÊME journée — un atelier de six
  // mécaniciens y arrive sans difficulté.
  for (let i = 0; i < NB; i++) {
    await prisma.job.create({
      data: {
        customerName: `Client ${String(i).padStart(2, '0')}`, vehicleModel: 'Clio',
        repairType: 'oil_change', estimatedDuration: 30,
        startTime: `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
        date: JOUR, garageId: garage.id, mechanicId: mecano.id,
      },
    })
  }
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

const journee = (requete = '') =>
  jobsGET(new Request(`http://localhost/api/jobs?date=${JOUR}${requete}`))

describe('planning — la journée entière est servie (GF-011)', () => {
  it('sans `limit`, la journée complète arrive (c’est l’appel du planning)', async () => {
    const corps = await (await journee()).json()
    expect(corps.total).toBe(NB)
    expect(corps.data, 'aucune intervention ne doit manquer à l’écran').toHaveLength(NB)
  })

  it('les interventions de FIN de journée sont bien là', async () => {
    // Le tri est date puis heure croissantes : ce sont elles que la troncature
    // faisait disparaître.
    const { data } = await (await journee()).json()
    const noms = data.map((j: { customerName: string }) => j.customerName)
    expect(noms).toContain(`Client ${String(NB - 1).padStart(2, '0')}`)
  })

  it('rien n’est servi au-delà du plafond de sécurité', async () => {
    const corps = await (await journee('&limit=99999')).json()
    expect(corps.limit).toBeLessThanOrEqual(500)
  })

  it('une limite explicite reste respectée', async () => {
    const corps = await (await journee('&limit=5')).json()
    expect(corps.data).toHaveLength(5)
    expect(corps.total, 'le total reste la vérité, quelle que soit la page').toBe(NB)
  })

  it('une liste SANS date reste paginée à 20 (comportement inchangé)', async () => {
    const corps = await (await jobsGET(new Request('http://localhost/api/jobs'))).json()
    expect(corps.limit).toBe(20)
    expect(corps.total).toBe(NB)
  })
})

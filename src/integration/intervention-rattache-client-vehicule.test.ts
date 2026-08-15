/**
 * GF-015 — planifier une intervention crée enfin le client et le véhicule.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `POST /api/clients` et `POST /api/vehicles` existaient et fonctionnaient, mais
 * AUCUN écran ne les appelait. La seule voie de saisie d'un nouveau client — la
 * modale d'intervention — écrivait un annuaire parallèle dans le `localStorage`
 * du poste (`gf_clients`) puis créait une intervention dont le nom du client, le
 * modèle et la plaque sont du texte libre.
 *
 * Sur une installation réelle : deux cents interventions planifiées, annuaire
 * Clients VIDE, table Vehicle VIDE. La fiche véhicule ouverte depuis le planning
 * ne trouvait rien, les alertes de contrôle technique ne remontaient jamais,
 * aucun accès portail ne pouvait être ouvert (il faut un `Client`), et toutes
 * les factures partaient avec `clientId = null`.
 *
 * Le rattachement se fait désormais CÔTÉ SERVEUR, à l'écriture de
 * l'intervention : l'unique point par lequel passent toutes les créations.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-rattachement.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/sync/job-sync', () => ({ pollJobSync: () => {}, scheduleJobSync: () => {} }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
let jobsPOST: (req: Request) => Promise<Response>
let jobPUT: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', mecano: '' }

const creer = (corps: Record<string, unknown>) =>
  jobsPOST(new Request('http://localhost/api/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repairType: 'oil_change', estimatedDuration: 60, startTime: '09:00',
      date: '2026-08-22', mechanicId: ids.mecano, ...corps,
    }),
  }))

const modifier = (id: string, corps: Record<string, unknown>) =>
  jobPUT(new Request('http://localhost/api/jobs/x', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }), { params: { id } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: jobsPOST } = (await import('@/app/api/jobs/route')) as any)
  ;({ PUT: jobPUT } = (await import('@/app/api/jobs/[id]/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Rattachement', slug: 'garage-rattachement' } })
  const mecano = await prisma.mechanic.create({ data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id } })
  ids.garage = garage.id; ids.mecano = mecano.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  await prisma.job.deleteMany({})
  await prisma.vehicle.deleteMany({})
  await prisma.client.deleteMany({})
})

describe('planifier une intervention matérialise le client et le véhicule (GF-015)', () => {
  it('crée le client, le véhicule, et RATTACHE l’intervention', async () => {
    const res = await creer({ customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD' })
    expect(res.status).toBe(201)
    const job = await res.json()

    const clients = await prisma.client.findMany({ where: { garageId: ids.garage } })
    expect(clients, 'l’annuaire Clients ne doit plus rester vide').toHaveLength(1)
    expect(clients[0].name).toBe('Jean Dupont')

    const vehicules = await prisma.vehicle.findMany({ where: { garageId: ids.garage } })
    expect(vehicules).toHaveLength(1)
    expect(vehicules[0].licensePlate).toBe('AB-123-CD')
    expect(vehicules[0].make, 'le premier mot du modèle saisi est la marque').toBe('Renault')
    expect(vehicules[0].model).toBe('Clio')
    expect(vehicules[0].clientId).toBe(clients[0].id)

    expect(job.vehicleId, 'l’intervention doit pointer sur le véhicule').toBe(vehicules[0].id)
  })

  it('la MÊME plaque écrite autrement ne crée pas un second véhicule', async () => {
    await creer({ customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD' })
    const deuxieme = await (await creer({
      customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'ab123cd',
    })).json()

    const vehicules = await prisma.vehicle.findMany({ where: { garageId: ids.garage } })
    expect(vehicules, '« AB-123-CD » et « ab123cd » sont la même voiture').toHaveLength(1)
    expect(deuxieme.vehicleId).toBe(vehicules[0].id)
  })

  it('le même client écrit avec une autre casse ou un accent n’est pas dupliqué', async () => {
    await creer({ customerName: 'Hélène Lefèvre', vehicleModel: 'Peugeot 208', licensePlate: 'CD-456-EF' })
    await creer({ customerName: 'helene lefevre', vehicleModel: 'Peugeot 308', licensePlate: 'EF-789-GH' })

    const clients = await prisma.client.findMany({ where: { garageId: ids.garage } })
    expect(clients, 'un annuaire qui double à chaque frappe est inutilisable').toHaveLength(1)
    expect(clients[0].name, 'la première orthographe saisie fait foi').toBe('Hélène Lefèvre')
    expect(await prisma.vehicle.count({ where: { garageId: ids.garage } })).toBe(2)
  })

  it('un véhicule connu ne CHANGE PAS de propriétaire sur une saisie différente', async () => {
    // Transférer une voiture d'un client à un autre sur une faute de frappe
    // serait bien pire que de ne rien faire.
    await creer({ customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD' })
    const proprietaire = (await prisma.vehicle.findFirst({ where: { garageId: ids.garage } })).clientId

    const job = await (await creer({
      customerName: 'Marie Martin', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD',
    })).json()

    const vehicule = await prisma.vehicle.findFirst({ where: { garageId: ids.garage } })
    expect(vehicule.clientId, 'le propriétaire du véhicule est inchangé').toBe(proprietaire)
    expect(job.vehicleId).toBe(vehicule.id)
    // Marie Martin n'est PAS créée : rien ne prouve qu'elle soit cliente, et la
    // voiture appartient déjà à quelqu'un.
    expect(await prisma.client.count({ where: { garageId: ids.garage } })).toBe(1)
  })

  it('sans plaque, le client est créé mais aucun véhicule inventé', async () => {
    const job = await (await creer({ customerName: 'Paul Sans Voiture', vehicleModel: 'Twingo' })).json()
    expect(await prisma.client.count({ where: { garageId: ids.garage } })).toBe(1)
    expect(await prisma.vehicle.count({ where: { garageId: ids.garage } }), 'la plaque est la seule identité fiable').toBe(0)
    expect(job.vehicleId).toBeNull()
  })

  it('un `vehicleId` explicite est respecté tel quel', async () => {
    const client = await prisma.client.create({ data: { name: 'Client Existant', garageId: ids.garage } })
    const vehicule = await prisma.vehicle.create({
      data: { licensePlate: 'ZZ-999-ZZ', make: 'Ford', model: 'Focus', clientId: client.id, garageId: ids.garage },
    })
    const job = await (await creer({
      customerName: 'Peu importe', vehicleModel: 'Autre', licensePlate: 'XX-000-XX', vehicleId: vehicule.id,
    })).json()

    expect(job.vehicleId).toBe(vehicule.id)
    expect(await prisma.vehicle.count({ where: { garageId: ids.garage } }), 'aucun véhicule créé en plus').toBe(1)
  })

  it('compléter la plaque APRÈS coup rattache aussi', async () => {
    const job = await (await creer({ customerName: 'Sophie Tardive', vehicleModel: 'Citroën C3' })).json()
    expect(job.vehicleId).toBeNull()

    const modifie = await (await modifier(job.id, { licensePlate: 'GH-321-IJ' })).json()
    expect(modifie.vehicleId, 'la saisie différée ne doit pas échapper au rattachement').toBeTruthy()

    const vehicule = await prisma.vehicle.findFirst({ where: { garageId: ids.garage } })
    expect(vehicule.licensePlate).toBe('GH-321-IJ')
    expect(vehicule.make).toBe('Citroën')
  })

  it('le rattachement reste cloisonné au garage', async () => {
    const autre = await prisma.garage.create({ data: { name: 'Autre', slug: 'autre-garage' } })
    const clientB = await prisma.client.create({ data: { name: 'Jean Dupont', garageId: autre.id } })
    await prisma.vehicle.create({
      data: { licensePlate: 'AB-123-CD', make: 'Renault', model: 'Clio', clientId: clientB.id, garageId: autre.id },
    })

    await creer({ customerName: 'Jean Dupont', vehicleModel: 'Renault Clio', licensePlate: 'AB-123-CD' })

    // Le véhicule du garage voisin ne doit ni être réutilisé ni être modifié.
    expect(await prisma.vehicle.count({ where: { garageId: ids.garage } })).toBe(1)
    expect(await prisma.vehicle.count({ where: { garageId: autre.id } })).toBe(1)
    expect(await prisma.client.count({ where: { garageId: ids.garage } })).toBe(1)

    await prisma.vehicle.deleteMany({ where: { garageId: autre.id } })
    await prisma.client.deleteMany({ where: { garageId: autre.id } })
    await prisma.garage.delete({ where: { id: autre.id } })
  })
})

/**
 * GF-DUR-017 — rendez-vous, de bout en bout : demande → confirmation → clôture.
 *
 * Quatre routes portaient la mécanique complète, avec une validation de créneau
 * éprouvée et une machine à états. Aucune n'avait d'écran — et le côté garage
 * n'était même pas VISIBLE dans l'inventaire des routes mortes, parce que deux
 * tests d'isolation l'importaient et que la garde comptait alors les tests
 * comme des appelants.
 *
 * Ce qui n'était donc éprouvé nulle part : qu'une demande faite depuis l'espace
 * client parvienne au garage, qu'il puisse s'y engager, et que le client le
 * voie. C'est ce que ce fichier exerce.
 *
 * Une DEMANDE n'est pas un rendez-vous : la distinction traverse tous les tests,
 * parce que c'est elle qui décide si un client se présente devant un rideau
 * fermé.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-rdv.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-rendez-vous-0123456789abcdef0123'

const sess = vi.hoisted(() => ({ garageId: '', role: 'OWNER' }))
vi.mock('@/lib/api-helpers', async () => {
  const reel = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers')
  return {
    ...reel,
    withAuth: (h: unknown) => h,
    requireSession: async () => ({
      user: { id: 'u-garage', role: sess.role, garageId: sess.garageId, name: 'Comptoir', email: 'g@test.fr' },
    }),
  }
})

let portalListe: (r: NextRequest) => Promise<Response>
let portalDemander: (r: NextRequest) => Promise<Response>
let portalDeplacer: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let portalAnnuler: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let garageListe: (r: NextRequest) => Promise<Response>
let garageAgir: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let prisma: any

let garageId: string, clientId: string, userId: string, cookie: string, vehiculeId: string

/** Date toujours future, indépendante du jour où la suite tourne. */
function demain(joursEnPlus = 1): string {
  const d = new Date()
  d.setDate(d.getDate() + joursEnPlus)
  return d.toISOString().slice(0, 10)
}

const req = (url: string, corps?: unknown, methode?: string) =>
  new NextRequest(`http://localhost${url}`, {
    method: methode ?? (corps === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', cookie: `${PORTAL_COOKIE}=${cookie}` },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })

const reqGarage = (url: string, corps?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: portalListe, POST: portalDemander } = (await import('@/app/api/portal/appointments/route')) as any)
  ;({ PATCH: portalDeplacer, DELETE: portalAnnuler } = (await import('@/app/api/portal/appointments/[id]/route')) as any)
  ;({ GET: garageListe } = (await import('@/app/api/appointments/route')) as any)
  ;({ POST: garageAgir } = (await import('@/app/api/appointments/[id]/route')) as any)
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.appointment.deleteMany({})
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
  await prisma.vehicle.deleteMany({})
  await prisma.client.deleteMany({})
  await prisma.garage.deleteMany({})

  garageId = (await prisma.garage.create({
    data: { name: 'Garage A', slug: `a-${Date.now()}`, workshopStartHour: 8, workshopEndHour: 18 },
  })).id
  sess.garageId = garageId
  sess.role = 'OWNER'
  clientId = (await prisma.client.create({ data: { garageId, name: 'Jean Dupont', email: 'jean@test.fr' } })).id
  vehiculeId = (await prisma.vehicle.create({
    data: { garageId, clientId, licensePlate: 'AA-123-BB', make: 'Peugeot', model: '308' },
  })).id
  userId = (await prisma.portalUser.create({
    data: {
      garageId, clientId, email: 'jean@test.fr', name: 'Jean',
      passwordHash: await bcrypt.hash('MotDePasseClient9', 10), emailVerified: true,
    },
  })).id
  const sid = `s-${Math.random().toString(36).slice(2)}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId: sid } })
  cookie = await signPortalSession({ sub: userId, sid, gid: garageId })
})

async function demander(sur: Partial<Record<string, unknown>> = {}) {
  const res = await portalDemander(req('/api/portal/appointments', {
    reason: 'Révision annuelle', date: demain(), startTime: '10:00', durationMin: 60,
    vehicleId: vehiculeId, licensePlate: 'AA-123-BB', vehicleModel: 'Peugeot 308',
    ...sur,
  }))
  return res
}

describe('la demande traverse jusqu\'au garage', () => {
  it('le créneau proposé arrive dans la liste du garage, en ATTENTE', async () => {
    const res = await demander()
    expect(res.status).toBe(201)
    const id = (await res.json()).appointment.id

    const liste = await (await garageListe(reqGarage('/api/appointments'))).json()
    expect(liste.appointments).toHaveLength(1)
    expect(liste.appointments[0].id).toBe(id)
    expect(liste.appointments[0].clientName).toBe('Jean')
    // `requested` : personne ne s'est encore engagé. Afficher « rendez-vous
    // pris » à ce stade ferait venir le client devant un rideau fermé.
    expect(liste.appointments[0].status).toBe('requested')
    expect(liste.appointments[0].licensePlate).toBe('AA-123-BB')
  })

  it('la confirmation du garage est visible par le client', async () => {
    const id = (await (await demander()).json()).appointment.id

    const r = await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })
    expect(r.status).toBe(200)
    expect((await r.json()).status).toBe('confirmed')

    const cote = await (await portalListe(req('/api/portal/appointments'))).json()
    expect(cote.appointments[0].status).toBe('confirmed')
  })

  it('les heures d\'ouverture accompagnent la liste du client', async () => {
    // Sans elles, le client ne peut que deviner puis se voir refuser : c'est le
    // serveur qui détient la contrainte que `validateSlot` applique.
    const d = await (await portalListe(req('/api/portal/appointments'))).json()
    expect(d.horaires).toEqual({ ouverture: 8, fermeture: 18 })
  })

  it('un rendez-vous confirmé puis honoré se clôt', async () => {
    const id = (await (await demander()).json()).appointment.id
    await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })
    const r = await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'complete' }), { params: { id } })
    expect((await r.json()).status).toBe('completed')
  })
})

describe('la validation du créneau protège les deux parties', () => {
  it('un créneau hors des heures d\'ouverture est refusé', async () => {
    for (const [heure, motif] of [['06:00', 'avant'], ['17:30', 'après']] as const) {
      // 17:30 + 60 min dépasse la fermeture à 18 h : c'est la DURÉE qui déborde.
      const r = await demander({ startTime: heure })
      expect(r.status, motif).toBe(400)
    }
    expect(await prisma.appointment.count()).toBe(0)
  })

  it('un créneau dans le passé est refusé', async () => {
    const r = await demander({ date: demain(-3) })
    expect(r.status).toBe(400)
    expect(await prisma.appointment.count()).toBe(0)
  })

  it('un motif vide est refusé', async () => {
    expect((await demander({ reason: '   ' })).status).toBe(400)
  })

  it('un véhicule qui n\'appartient pas au client est refusé', async () => {
    const tiers = await prisma.client.create({ data: { garageId, name: 'Tiers' } })
    const sienne = await prisma.vehicle.create({
      data: { garageId, clientId: tiers.id, licensePlate: 'ZZ-999-ZZ', make: 'Renault', model: 'Clio' },
    })
    expect((await demander({ vehicleId: sienne.id })).status).toBe(400)
    expect(await prisma.appointment.count()).toBe(0)
  })
})

describe('déplacement et annulation par le client', () => {
  it('déplacer un créneau CONFIRMÉ le remet en attente', async () => {
    const id = (await (await demander()).json()).appointment.id
    await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })

    const r = await portalDeplacer(
      req(`/api/portal/appointments/${id}`, { date: demain(3), startTime: '14:00' }, 'PATCH'),
      { params: { id } },
    )
    expect(r.status).toBe(200)
    // Le garage doit se réengager : conserver la confirmation ferait croire à
    // une place réservée que personne n'a accordée.
    expect((await r.json()).appointment.status).toBe('requested')
  })

  it('le nouveau créneau est validé comme le premier', async () => {
    const id = (await (await demander()).json()).appointment.id
    const r = await portalDeplacer(
      req(`/api/portal/appointments/${id}`, { startTime: '05:00' }, 'PATCH'),
      { params: { id } },
    )
    expect(r.status).toBe(400)
    expect((await prisma.appointment.findUnique({ where: { id } })).startTime).toBe('10:00')
  })

  it('le client annule le sien', async () => {
    const id = (await (await demander()).json()).appointment.id
    const r = await portalAnnuler(req(`/api/portal/appointments/${id}`, undefined, 'DELETE'), { params: { id } })
    expect((await r.json()).status).toBe('cancelled')
  })

  it('un rendez-vous terminé ne se déplace ni ne s\'annule plus', async () => {
    const id = (await (await demander()).json()).appointment.id
    await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })
    await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'complete' }), { params: { id } })

    expect((await portalDeplacer(req(`/api/portal/appointments/${id}`, { startTime: '11:00' }, 'PATCH'), { params: { id } })).status).toBe(409)
    expect((await portalAnnuler(req(`/api/portal/appointments/${id}`, undefined, 'DELETE'), { params: { id } })).status).toBe(409)
  })
})

describe('transitions impossibles et isolation', () => {
  it('on ne confirme pas deux fois', async () => {
    const id = (await (await demander()).json()).appointment.id
    await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })
    const r = await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'confirm' }), { params: { id } })
    expect(r.status).toBe(409)
  })

  it('on ne clôt pas une demande jamais confirmée', async () => {
    const id = (await (await demander()).json()).appointment.id
    expect((await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'complete' }), { params: { id } })).status).toBe(409)
  })

  it('un mécanicien ne s\'engage pas à la place du comptoir', async () => {
    // Consulter le planning concerne tout l'atelier ; annuler le rendez-vous
    // d'un client est un engagement pris envers lui.
    const id = (await (await demander()).json()).appointment.id
    sess.role = 'MECHANIC'
    for (const action of ['confirm', 'cancel', 'complete']) {
      expect((await garageAgir(reqGarage(`/api/appointments/${id}`, { action }), { params: { id } })).status).toBe(403)
    }
    expect((await prisma.appointment.findUnique({ where: { id } })).status).toBe('requested')
  })

  it('un garage voisin ne voit ni ne touche ce rendez-vous', async () => {
    const id = (await (await demander()).json()).appointment.id
    sess.garageId = (await prisma.garage.create({ data: { name: 'B', slug: `b-${Date.now()}` } })).id

    expect((await (await garageListe(reqGarage('/api/appointments'))).json()).appointments).toHaveLength(0)
    expect((await garageAgir(reqGarage(`/api/appointments/${id}`, { action: 'cancel' }), { params: { id } })).status).toBe(404)
    expect((await prisma.appointment.findUnique({ where: { id } })).status).toBe('requested')
  })
})

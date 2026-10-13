/**
 * Demandes de rendez-vous : le poste doit les VOIR, et le client doit voir la
 * réponse.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Une demande n'est créée que par `/api/portal/appointments`, depuis l'espace
 * client servi par le CLOUD. La voie de retour ne rapatriait que les
 * interventions, les notes et les photos : sur un poste, la table restait vide
 * POUR TOUJOURS. Le bouton « Rendez-vous » ouvrait un panneau éternellement
 * vide, et le garagiste en concluait qu'aucun client n'en demandait. Un silence
 * coûte plus cher qu'une erreur : rien n'invite à chercher.
 *
 * ─── Ce que ces tests protègent ─────────────────────────────────────────────
 * La descente, la remontée de la décision, et surtout la règle d'arbitrage : le
 * cloud fait autorité sur la DEMANDE, le poste sur la RÉPONSE. Un rapatriement
 * ne doit jamais effacer une confirmation prise au comptoir.
 *
 * Base RÉELLE ; seul le transport est simulé.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-rdv-retour.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ post: vi.fn(), licence: 'GF2.licence' as string | null }))
vi.mock('@/lib/sync/cloud-client', () => ({
  cloudPost: (...a: unknown[]) => h.post(...a),
  garageLicenseToken: async () => h.licence,
  isDesktopInstance: () => true,
}))

let prisma: any
let pullGarageAppointments: any
let pushAppointmentDecision: any
let garageId = ''
let autreGarage = ''

const distant = (over: Record<string, unknown> = {}) => ({
  id: 'rdv-cloud-1', clientName: 'Mme Martin', vehicleModel: 'Clio IV',
  licensePlate: 'AA-123-BB', reason: 'Révision annuelle', date: '2026-09-01',
  startTime: '09:00', durationMin: 60, status: 'requested', notes: null,
  ...over,
})

const repond = (appointments: unknown[]) =>
  h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true, appointments } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ pullGarageAppointments, pushAppointmentDecision } = await import('@/lib/sync/appointment-sync'))
  garageId = (await prisma.garage.create({ data: { name: 'A', slug: 'rdv-a' } })).id
  autreGarage = (await prisma.garage.create({ data: { name: 'B', slug: 'rdv-b' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.licence = 'GF2.licence'
  h.post.mockReset()
  repond([])
  await prisma.appointment.deleteMany({})
})

describe('les demandes du client arrivent enfin sur le poste', () => {
  it('une demande inconnue est créée localement', async () => {
    repond([distant()])
    const r = await pullGarageAppointments(garageId)
    expect(r.appliques).toBe(1)

    const cree = await prisma.appointment.findUnique({ where: { id: 'rdv-cloud-1' } })
    expect(cree.clientName).toBe('Mme Martin')
    expect(cree.reason).toBe('Révision annuelle')
    expect(cree.garageId, 'la demande appartient au garage de la licence').toBe(garageId)
  })

  it('aucun lien pendant vers une fiche client non publiée', async () => {
    repond([distant()])
    await pullGarageAppointments(garageId)
    const cree = await prisma.appointment.findUnique({ where: { id: 'rdv-cloud-1' } })
    expect(cree.clientId, 'une clé étrangère pendante casserait la contrainte').toBeNull()
    expect(cree.vehicleId).toBeNull()
  })

  it('rejouer le même passage ne crée pas de doublon', async () => {
    repond([distant()])
    await pullGarageAppointments(garageId)
    await pullGarageAppointments(garageId)
    expect(await prisma.appointment.count({})).toBe(1)
  })

  it('le curseur repart de ce que le poste détient RÉELLEMENT', async () => {
    repond([distant()])
    await pullGarageAppointments(garageId)
    h.post.mockClear()
    repond([])
    await pullGarageAppointments(garageId)
    // Un curseur en mémoire redemanderait tout l'historique à chaque démarrage.
    expect(h.post.mock.calls[0][1].since, 'le curseur doit être déduit de la base').toBeDefined()
  })

  it('sans licence garage : aucun appel réseau', async () => {
    h.licence = null
    const r = await pullGarageAppointments(garageId)
    expect(r.code).toBe('NO_GARAGE_LICENSE')
    expect(h.post).not.toHaveBeenCalled()
  })
})

describe('le poste fait autorité sur la RÉPONSE', () => {
  it('une confirmation locale n’est pas effacée par un rapatriement', async () => {
    // Le garage a confirmé au comptoir ; la remontée n'a pas encore eu lieu.
    await prisma.appointment.create({
      data: {
        id: 'rdv-cloud-1', garageId, clientName: 'Mme Martin', reason: 'Révision',
        date: '2026-09-01', startTime: '09:00', status: 'confirmed',
      },
    })
    repond([distant({ status: 'requested' })])
    await pullGarageAppointments(garageId)

    const apres = await prisma.appointment.findUnique({ where: { id: 'rdv-cloud-1' } })
    expect(apres.status, 'le statut local ne doit jamais reculer').toBe('confirmed')
  })

  it('mais le texte de la demande, lui, est mis à jour', async () => {
    await prisma.appointment.create({
      data: {
        id: 'rdv-cloud-1', garageId, clientName: 'Mme Martin', reason: 'ancien motif',
        date: '2026-09-01', startTime: '09:00', status: 'confirmed',
      },
    })
    repond([distant({ reason: 'Freins qui grincent', status: 'requested' })])
    await pullGarageAppointments(garageId)
    const apres = await prisma.appointment.findUnique({ where: { id: 'rdv-cloud-1' } })
    expect(apres.reason, 'le client est l’auteur de sa demande').toBe('Freins qui grincent')
  })

  it('une demande encore « requested » localement suit le cloud', async () => {
    await prisma.appointment.create({
      data: {
        id: 'rdv-cloud-1', garageId, clientName: 'M', reason: 'r',
        date: '2026-09-01', startTime: '09:00', status: 'requested',
      },
    })
    repond([distant({ status: 'cancelled' })])
    await pullGarageAppointments(garageId)
    const apres = await prisma.appointment.findUnique({ where: { id: 'rdv-cloud-1' } })
    expect(apres.status, 'un client qui annule doit être suivi').toBe('cancelled')
  })
})

describe('la décision du garage remonte au client', () => {
  it('l’ACTION est transmise, pas le statut', async () => {
    h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true, status: 'confirmed' } })
    const r = await pushAppointmentDecision(garageId, 'rdv-cloud-1', 'confirm')
    expect(r.remonte).toBe(true)
    expect(h.post.mock.calls[0][1]).toMatchObject({
      mode: 'answer', appointmentId: 'rdv-cloud-1', action: 'confirm',
    })
    // Transmettre un statut laisserait le poste écrire un état impossible ;
    // c'est la machine à états du service qui doit trancher.
    expect(h.post.mock.calls[0][1].status).toBeUndefined()
  })

  it('hors ligne : la remontée échoue et le DIT', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const r = await pushAppointmentDecision(garageId, 'rdv-cloud-1', 'confirm')
    expect(r.remonte, 'l’écran ne doit pas laisser croire que le client a été prévenu').toBe(false)
    expect(r.code).toBe('NETWORK')
  })
})

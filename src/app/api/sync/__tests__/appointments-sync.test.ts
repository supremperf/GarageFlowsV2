/**
 * POST /api/sync/appointments — les deux mouvements, côté CLOUD.
 *
 * C'est un canal ouvert à des postes. Un poste est un client comme un autre :
 * la portée garage et la machine à états doivent être appliquées ICI, pas
 * seulement avant l'appel.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-appointments.db')
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

let POST: (req: Request) => Promise<Response>
let prisma: any
const ids = { a: '', b: '' }

const appeler = (corps: Record<string, unknown>) =>
  POST(new Request('http://localhost/api/sync/appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.peu-importe', ...corps }),
  }))

const creer = (id: string, garageId: string, status = 'requested') =>
  prisma.appointment.create({
    data: { id, garageId, clientName: 'C', reason: 'r', date: '2026-09-01', startTime: '09:00', status },
  })

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/appointments/route')) as any)
  ids.a = (await prisma.garage.create({ data: { name: 'A', slug: 'sa-a' } })).id
  ids.b = (await prisma.garage.create({ data: { name: 'B', slug: 'sa-b' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.a
  h.code = null
  await prisma.appointment.deleteMany({})
})

describe('la lecture est bornée au garage de la licence', () => {
  it('les demandes d’un autre garage ne sortent pas', async () => {
    await creer('chez-a', ids.a)
    await creer('chez-b', ids.b)
    const corps = await (await appeler({ mode: 'pull' })).json()
    const identifiants = corps.appointments.map((d: { id: string }) => d.id)
    expect(identifiants).toContain('chez-a')
    expect(identifiants, 'sans portée garage, un poste lirait les rendez-vous d’un autre')
      .not.toContain('chez-b')
  })

  it('une licence refusée ne lit rien', async () => {
    h.code = 'LICENSE_REVOKED'
    await creer('chez-a', ids.a)
    expect((await appeler({ mode: 'pull' })).status).toBe(403)
  })
})

describe('la machine à états décide, pas le poste', () => {
  it('confirmer une demande en attente aboutit', async () => {
    await creer('rdv', ids.a, 'requested')
    const r = await appeler({ mode: 'answer', appointmentId: 'rdv', action: 'confirm' })
    expect(r.status).toBe(200)
    expect((await prisma.appointment.findUnique({ where: { id: 'rdv' } })).status).toBe('confirmed')
  })

  it('une transition impossible est REFUSÉE', async () => {
    await creer('rdv', ids.a, 'cancelled')
    const r = await appeler({ mode: 'answer', appointmentId: 'rdv', action: 'complete' })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('TRANSITION_REFUSEE')
    expect((await prisma.appointment.findUnique({ where: { id: 'rdv' } })).status,
      'un poste ne doit pas pouvoir écrire un état impossible').toBe('cancelled')
  })

  it('la demande d’un autre garage est INTROUVABLE, pas refusée', async () => {
    await creer('rdv', ids.b, 'requested')
    const r = await appeler({ mode: 'answer', appointmentId: 'rdv', action: 'confirm' })
    expect(r.status).toBe(404)
    expect((await prisma.appointment.findUnique({ where: { id: 'rdv' } })).status).toBe('requested')
  })

  it('un mode inconnu est refusé', async () => {
    const r = await appeler({ mode: 'tout-effacer' })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('UNKNOWN_MODE')
  })
})

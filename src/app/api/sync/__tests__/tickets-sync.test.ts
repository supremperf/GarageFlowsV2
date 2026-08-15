/**
 * POST /api/sync/tickets — messagerie client, côté CLOUD.
 *
 * Canal ouvert à des postes : la portée garage, la machine à états et le
 * cloisonnement des secrets doivent être appliqués ICI, pas seulement avant
 * l'appel.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-tickets.db')
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
  POST(new Request('http://localhost/api/sync/tickets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.peu-importe', ...corps }),
  }))

async function ticket(id: string, garageId: string, status = 'open') {
  const pu = await prisma.portalUser.create({
    data: { garageId, email: `${id}@example.test`, passwordHash: '$2a$12$secret-a-ne-jamais-sortir', name: 'Client' },
  })
  return prisma.portalTicket.create({
    data: {
      id, garageId, portalUserId: pu.id, subject: 'Sujet', status,
      messages: { create: [{ authorType: 'client', authorName: 'Client', body: 'Bonjour' }] },
    },
  })
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/tickets/route')) as any)
  ids.a = (await prisma.garage.create({ data: { name: 'A', slug: 'st-a' } })).id
  ids.b = (await prisma.garage.create({ data: { name: 'B', slug: 'st-b' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.a
  h.code = null
  await prisma.portalTicketMessage.deleteMany({})
  await prisma.portalTicket.deleteMany({})
  await prisma.portalUser.deleteMany({})
})

describe('la lecture est bornée au garage, et ne fait sortir aucun secret', () => {
  it('la correspondance d’un autre garage ne sort pas', async () => {
    await ticket('chez-a', ids.a)
    await ticket('chez-b', ids.b)
    const corps = await (await appeler({ mode: 'pull' })).json()
    const identifiants = corps.tickets.map((t: { id: string }) => t.id)
    expect(identifiants).toContain('chez-a')
    expect(identifiants, 'lire la correspondance d’un autre garage serait une fuite grave')
      .not.toContain('chez-b')
  })

  it('le haché de mot de passe de l’auteur ne redescend JAMAIS', async () => {
    await ticket('chez-a', ids.a)
    const brut = JSON.stringify(await (await appeler({ mode: 'pull' })).json())
    expect(brut, 'le poste n’a pas à détenir de quoi ouvrir une session au nom du client')
      .not.toMatch(/secret-a-ne-jamais-sortir|passwordHash/)
    // …mais ce que le garage doit AFFICHER est bien là.
    expect(brut).toMatch(/chez-a@example.test/)
  })

  it('une licence refusée ne lit rien', async () => {
    h.code = 'LICENSE_REVOKED'
    await ticket('chez-a', ids.a)
    expect((await appeler({ mode: 'pull' })).status).toBe(403)
  })
})

describe('répondre passe par la machine à états', () => {
  it('une réponse est enregistrée et fait avancer la conversation', async () => {
    await ticket('t1', ids.a, 'open')
    const r = await appeler({ mode: 'answer', ticketId: 't1', action: 'staff_reply', message: 'Passez lundi.', authorName: 'Atelier' })
    expect(r.status).toBe(200)
    const messages = await prisma.portalTicketMessage.findMany({ where: { ticketId: 't1' } })
    expect(messages).toHaveLength(2)
    expect(messages.some((m: { body: string }) => m.body === 'Passez lundi.')).toBe(true)
  })

  it('répondre dans une conversation CLÔTURÉE est refusé', async () => {
    await ticket('t1', ids.a, 'closed')
    const r = await appeler({ mode: 'answer', ticketId: 't1', action: 'staff_reply', message: 'x' })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('TICKET_CLOTURE')
    expect(await prisma.portalTicketMessage.count({ where: { ticketId: 't1' } }),
      'le client ne rouvrira pas une conversation close pour lire').toBe(1)
  })

  it('un message vide est refusé', async () => {
    await ticket('t1', ids.a)
    expect((await appeler({ mode: 'answer', ticketId: 't1', action: 'staff_reply', message: '  ' })).status).toBe(400)
  })

  it('un message démesuré est refusé', async () => {
    await ticket('t1', ids.a)
    const r = await appeler({ mode: 'answer', ticketId: 't1', action: 'staff_reply', message: 'x'.repeat(5001) })
    expect(r.status).toBe(413)
  })

  it('le ticket d’un autre garage est INTROUVABLE', async () => {
    await ticket('t1', ids.b)
    const r = await appeler({ mode: 'answer', ticketId: 't1', action: 'staff_reply', message: 'x' })
    expect(r.status).toBe(404)
    expect(await prisma.portalTicketMessage.count({ where: { ticketId: 't1' } })).toBe(1)
  })

  it('un mode inconnu est refusé', async () => {
    expect((await appeler({ mode: 'tout-effacer' })).status).toBe(400)
  })
})

/**
 * Messagerie client : le garage doit LIRE ce qu'on lui écrit, et pouvoir répondre.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Un ticket n'est créé que par `/api/portal/tickets`, depuis l'espace client
 * servi par le CLOUD. Rien ne le rapatriait : sur un poste, la table restait
 * vide POUR TOUJOURS. Le bouton « Messages » ouvrait un panneau vide, et le
 * garagiste en concluait qu'aucun client ne lui écrivait. Un client qui signale
 * un problème et n'obtient jamais de réponse ne revient pas.
 *
 * ─── Le compte « ombre » ────────────────────────────────────────────────────
 * `portalUserId` est obligatoire, et l'auteur peut s'être inscrit seul en ligne —
 * donc être inconnu du poste. On crée alors un compte local réduit à l'affichage,
 * au haché VIDE : aucune comparaison bcrypt ne peut réussir, donc il ne peut
 * servir à s'authentifier. Le vrai compte reste dans le cloud. Ces tests le
 * verrouillent : c'est la partie qu'on serait tenté de « simplifier » un jour.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-messages-retour.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ post: vi.fn(), licence: 'GF2.licence' as string | null }))
vi.mock('@/lib/sync/cloud-client', () => ({
  cloudPost: (...a: unknown[]) => h.post(...a),
  garageLicenseToken: async () => h.licence,
  isDesktopInstance: () => true,
}))

let prisma: any
let pullGarageTickets: any
let pushTicketAnswer: any
let garageId = ''

const ticketDistant = (over: Record<string, unknown> = {}) => ({
  id: 'ticket-cloud-1',
  subject: 'Bruit au freinage',
  category: 'technique', priority: 'normal', status: 'open',
  lastMessageAt: '2026-08-14T10:00:00.000Z', closedAt: null,
  portalUser: { id: 'pu-cloud-1', email: 'client@example.test', name: 'Mme Martin' },
  messages: [
    { id: 'msg-1', authorType: 'client', authorName: 'Mme Martin', body: 'Un bruit à l’avant droit.', createdAt: '2026-08-14T10:00:00.000Z' },
  ],
  ...over,
})

const repond = (tickets: unknown[]) =>
  h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true, tickets } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ pullGarageTickets, pushTicketAnswer } = await import('@/lib/sync/ticket-sync'))
  garageId = (await prisma.garage.create({ data: { name: 'A', slug: 'msg-a' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.licence = 'GF2.licence'
  h.post.mockReset()
  repond([])
  await prisma.portalTicketMessage.deleteMany({})
  await prisma.portalTicket.deleteMany({})
  await prisma.portalUser.deleteMany({})
})

describe('les messages des clients arrivent enfin sur le poste', () => {
  it('la conversation et ses messages sont créés localement', async () => {
    repond([ticketDistant()])
    const r = await pullGarageTickets(garageId)
    expect(r.appliques).toBe(1)

    const t = await prisma.portalTicket.findUnique({
      where: { id: 'ticket-cloud-1' }, include: { messages: true },
    })
    expect(t.subject).toBe('Bruit au freinage')
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0].body).toBe('Un bruit à l’avant droit.')
  })

  it('rejouer un passage ne duplique ni la conversation ni les messages', async () => {
    repond([ticketDistant()])
    await pullGarageTickets(garageId)
    await pullGarageTickets(garageId)
    expect(await prisma.portalTicket.count({})).toBe(1)
    expect(await prisma.portalTicketMessage.count({})).toBe(1)
  })

  it('une réponse du garage venue du cloud s’ajoute à la conversation', async () => {
    repond([ticketDistant()])
    await pullGarageTickets(garageId)
    repond([ticketDistant({
      status: 'answered',
      messages: [
        { id: 'msg-1', authorType: 'client', authorName: 'Mme Martin', body: 'Un bruit à l’avant droit.', createdAt: '2026-08-14T10:00:00.000Z' },
        { id: 'msg-2', authorType: 'staff', authorName: 'Atelier', body: 'Passez lundi.', createdAt: '2026-08-14T11:00:00.000Z' },
      ],
    })])
    await pullGarageTickets(garageId)
    expect(await prisma.portalTicketMessage.count({})).toBe(2)
  })

  it('sans licence garage : aucun appel réseau', async () => {
    h.licence = null
    const r = await pullGarageTickets(garageId)
    expect(r.code).toBe('NO_GARAGE_LICENSE')
    expect(h.post).not.toHaveBeenCalled()
  })
})

describe('le compte « ombre » ne peut pas servir à s’authentifier', () => {
  it('l’auteur inconnu est créé avec un haché VIDE', async () => {
    repond([ticketDistant()])
    await pullGarageTickets(garageId)
    const pu = await prisma.portalUser.findUnique({ where: { id: 'pu-cloud-1' } })
    expect(pu.email).toBe('client@example.test')
    expect(pu.passwordHash, 'aucune comparaison bcrypt ne peut réussir sur une chaîne vide').toBe('')
  })

  it('un compte local EXISTANT n’est jamais écrasé', async () => {
    // Compte ouvert par le garage, publié vers le cloud : son haché est réel et
    // ne doit surtout pas être remplacé par une chaîne vide.
    await prisma.portalUser.create({
      data: { id: 'pu-local', garageId, email: 'client@example.test', passwordHash: '$2a$12$vrai-hache' },
    })
    repond([ticketDistant()])
    await pullGarageTickets(garageId)

    const pu = await prisma.portalUser.findUnique({ where: { id: 'pu-local' } })
    expect(pu.passwordHash, 'écraser le haché couperait l’accès du client').toBe('$2a$12$vrai-hache')
    // Et la conversation se rattache au compte existant, pas à un doublon.
    const t = await prisma.portalTicket.findUnique({ where: { id: 'ticket-cloud-1' } })
    expect(t.portalUserId).toBe('pu-local')
    expect(await prisma.portalUser.count({})).toBe(1)
  })
})

describe('répondre atteint réellement le client', () => {
  it('la réponse remonte avec son texte et son auteur', async () => {
    h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
    const r = await pushTicketAnswer(garageId, 'ticket-cloud-1', 'staff_reply', {
      message: 'Passez lundi.', authorName: 'Atelier',
    })
    expect(r.remonte).toBe(true)
    expect(h.post.mock.calls[0][1]).toMatchObject({
      mode: 'answer', ticketId: 'ticket-cloud-1', action: 'staff_reply',
      message: 'Passez lundi.', authorName: 'Atelier',
    })
  })

  it('hors ligne : la remontée échoue et le DIT', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const r = await pushTicketAnswer(garageId, 'ticket-cloud-1', 'staff_reply', { message: 'x' })
    expect(r.remonte, 'répondre dans le vide sans le savoir est le pire des cas').toBe(false)
  })

  it('la clôture remonte aussi', async () => {
    h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
    await pushTicketAnswer(garageId, 'ticket-cloud-1', 'close')
    expect(h.post.mock.calls[0][1]).toMatchObject({ action: 'close' })
  })
})

/**
 * GF-DUR-014 — la messagerie, de bout en bout : client → garage → client.
 *
 * Les cinq routes étaient éprouvées séparément. Ce qui ne l'était pas, c'est la
 * TRAVERSÉE : qu'un message écrit depuis l'espace client atterrisse dans la
 * boîte du garage, que la réponse revienne au client, et que le statut désigne à
 * chaque étape celui qui doit agir. C'est exactement ce que personne ne pouvait
 * vérifier tant qu'aucun des deux écrans n'existait.
 *
 * L'isolation est éprouvée dans le même mouvement : un garage voisin ne doit
 * rien voir, et un client ne doit pas atteindre le fil d'un autre.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-messagerie.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-messagerie-0123456789abcdef0123'

/** Session du POSTE (garage). Le garage courant est variable pour l'isolation. */
const sess = vi.hoisted(() => ({ garageId: '', role: 'OWNER', name: 'Comptoir' }))
vi.mock('@/lib/api-helpers', async () => {
  const reel = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers')
  return {
    ...reel,
    withAuth: (h: unknown) => h,
    requireSession: async () => ({
      user: { id: 'u-garage', role: sess.role, garageId: sess.garageId, name: sess.name, email: 'garage@test.fr' },
    }),
  }
})

let portalListe: (r: NextRequest) => Promise<Response>
let portalCreer: (r: NextRequest) => Promise<Response>
let portalFil: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let portalRepondre: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let portalClore: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let garageListe: (r: NextRequest) => Promise<Response>
let garageFil: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let garageAgir: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let prisma: any

let garageId: string, clientId: string, userId: string, cookie: string, vehiculeId: string
const MDP = 'MotDePasseClient9'

const req = (url: string, corps?: unknown, avecCookie = true) =>
  new NextRequest(`http://localhost${url}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(avecCookie ? { cookie: `${PORTAL_COOKIE}=${cookie}` } : {}),
    },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: portalListe, POST: portalCreer } = (await import('@/app/api/portal/tickets/route')) as any)
  ;({ GET: portalFil, POST: portalRepondre } = (await import('@/app/api/portal/tickets/[id]/route')) as any)
  ;({ POST: portalClore } = (await import('@/app/api/portal/tickets/[id]/close/route')) as any)
  ;({ GET: garageListe } = (await import('@/app/api/tickets/route')) as any)
  ;({ GET: garageFil, POST: garageAgir } = (await import('@/app/api/tickets/[id]/route')) as any)
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.portalTicketMessage.deleteMany({})
  await prisma.portalTicket.deleteMany({})
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
  await prisma.vehicle.deleteMany({})
  await prisma.client.deleteMany({})
  await prisma.garage.deleteMany({})

  garageId = (await prisma.garage.create({ data: { name: 'Garage A', slug: `a-${Date.now()}` } })).id
  sess.garageId = garageId
  sess.role = 'OWNER'
  clientId = (await prisma.client.create({ data: { garageId, name: 'Jean Dupont', email: 'jean@test.fr' } })).id
  vehiculeId = (await prisma.vehicle.create({
    data: { garageId, clientId, licensePlate: 'AA-123-BB', make: 'Peugeot', model: '308' },
  })).id
  userId = (await prisma.portalUser.create({
    data: {
      garageId, clientId, email: 'jean@test.fr', name: 'Jean',
      passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true,
    },
  })).id
  const sid = `s-${Math.random().toString(36).slice(2)}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId: sid } })
  cookie = await signPortalSession({ sub: userId, sid, gid: garageId })
})

/** Ouvre un fil et rend son identifiant. */
async function ouvrirFil(sujet = 'Question sur ma facture') {
  const res = await portalCreer(req('/api/portal/tickets', {
    subject: sujet, message: 'Bonjour, je ne comprends pas la ligne 3.', category: 'invoice', vehicleId: vehiculeId,
  }))
  expect(res.status).toBe(201)
  return (await res.json()).ticket.id as string
}

describe('la conversation traverse réellement les deux côtés', () => {
  it('le message du client arrive dans la boîte du garage', async () => {
    const id = await ouvrirFil()

    const boite = await (await garageListe(req('/api/tickets'))).json()
    expect(boite.tickets).toHaveLength(1)
    expect(boite.tickets[0].id).toBe(id)
    expect(boite.tickets[0].subject).toBe('Question sur ma facture')
    // `open` : le client attend. C'est ce que le panneau garage met en avant.
    expect(boite.tickets[0].status).toBe('open')

    const fil = await (await garageFil(req(`/api/tickets/${id}`), { params: { id } })).json()
    expect(fil.ticket.messages).toHaveLength(1)
    expect(fil.ticket.messages[0].authorType).toBe('client')
    expect(fil.ticket.messages[0].body).toContain('ligne 3')
  })

  it('la réponse du garage revient au client, et le statut change de camp', async () => {
    const id = await ouvrirFil()

    const rep = await garageAgir(req(`/api/tickets/${id}`, { message: 'La ligne 3 correspond au filtre à huile.' }), { params: { id } })
    expect(rep.status).toBe(200)
    expect((await rep.json()).status).toBe('answered')

    const cote = await (await portalFil(req(`/api/portal/tickets/${id}`), { params: { id } })).json()
    expect(cote.ticket.messages).toHaveLength(2)
    expect(cote.ticket.messages[1].authorType).toBe('staff')
    expect(cote.ticket.messages[1].body).toContain('filtre à huile')
    // `answered` : la balle est chez le client — le panneau garage le retire
    // donc de « À traiter ».
    expect(cote.ticket.status).toBe('answered')
  })

  it('une relance du client remet la balle chez le garage', async () => {
    const id = await ouvrirFil()
    await garageAgir(req(`/api/tickets/${id}`, { message: 'Réponse.' }), { params: { id } })

    await portalRepondre(req(`/api/portal/tickets/${id}`, { message: 'Merci, mais et la ligne 4 ?' }), { params: { id } })

    const boite = await (await garageListe(req('/api/tickets'))).json()
    expect(boite.tickets[0].status).toBe('pending')
    expect(boite.tickets[0].messageCount).toBe(3)
  })

  it('le véhicule choisi par le client est rattaché au fil', async () => {
    const id = await ouvrirFil()
    const t = await prisma.portalTicket.findUnique({ where: { id } })
    // Sans cela, le garage doit demander de quelle voiture on parle.
    expect(t.vehicleId).toBe(vehiculeId)
  })
})

describe('clôture — aucun message n\'entre plus', () => {
  it('le garage clôt ; le client ne peut plus écrire, mais peut rouvrir', async () => {
    const id = await ouvrirFil()
    await garageAgir(req(`/api/tickets/${id}`, { close: true }), { params: { id } })

    const refus = await portalRepondre(req(`/api/portal/tickets/${id}`, { message: 'Encore une chose…' }), { params: { id } })
    expect(refus.status).toBe(409)
    // C'est la raison pour laquelle l'écran retire le champ de saisie sur un fil
    // clos : laisser écrire pour refuser ensuite ferait perdre son texte.
    expect(await prisma.portalTicketMessage.count({ where: { ticketId: id } })).toBe(1)

    const reouvre = await portalClore(req(`/api/portal/tickets/${id}/close`, { reopen: true }), { params: { id } })
    expect(reouvre.status).toBe(200)
    expect((await reouvre.json()).status).toBe('open')

    const apres = await portalRepondre(req(`/api/portal/tickets/${id}`, { message: 'Encore une chose…' }), { params: { id } })
    expect(apres.status).toBe(200)
  })

  it('le client clôt de son côté ; le garage peut rouvrir', async () => {
    const id = await ouvrirFil()
    await portalClore(req(`/api/portal/tickets/${id}/close`, {}), { params: { id } })
    expect((await prisma.portalTicket.findUnique({ where: { id } })).status).toBe('closed')

    const r = await garageAgir(req(`/api/tickets/${id}`, { reopen: true }), { params: { id } })
    expect((await r.json()).status).toBe('open')
  })

  it('le garage ne peut pas répondre à un fil clos', async () => {
    const id = await ouvrirFil()
    await portalClore(req(`/api/portal/tickets/${id}/close`, {}), { params: { id } })
    const r = await garageAgir(req(`/api/tickets/${id}`, { message: 'Bonjour' }), { params: { id } })
    expect(r.status).toBe(409)
  })
})

describe('isolation', () => {
  it('un garage voisin ne voit rien de cette conversation', async () => {
    const id = await ouvrirFil()
    const voisin = (await prisma.garage.create({ data: { name: 'Garage B', slug: `b-${Date.now()}` } })).id
    sess.garageId = voisin

    expect((await (await garageListe(req('/api/tickets'))).json()).tickets).toHaveLength(0)
    // Introuvable, pas refusé : un identifiant ne doit rien révéler.
    expect((await garageFil(req(`/api/tickets/${id}`), { params: { id } })).status).toBe(404)
    expect((await garageAgir(req(`/api/tickets/${id}`, { message: 'Intrusion' }), { params: { id } })).status).toBe(404)
    expect(await prisma.portalTicketMessage.count({ where: { ticketId: id } })).toBe(1)
  })

  it('un autre client du MÊME garage n\'atteint pas ce fil', async () => {
    const id = await ouvrirFil()
    const autre = await prisma.portalUser.create({
      data: { garageId, email: 'autre@test.fr', passwordHash: 'x', emailVerified: true },
    })
    const sid = `s-autre-${Date.now()}`
    await prisma.portalDevice.create({ data: { portalUserId: autre.id, sessionId: sid } })
    const cookieAutre = await signPortalSession({ sub: autre.id, sid, gid: garageId })

    const lecture = await portalFil(
      new NextRequest(`http://localhost/api/portal/tickets/${id}`, {
        headers: { cookie: `${PORTAL_COOKIE}=${cookieAutre}` },
      }),
      { params: { id } },
    )
    expect(lecture.status).toBe(404)
  })

  it('un véhicule qui n\'appartient pas au client est refusé', async () => {
    // Sinon le fil se rattacherait à la voiture de quelqu'un d'autre.
    const tiers = await prisma.client.create({ data: { garageId, name: 'Tiers' } })
    const sienne = await prisma.vehicle.create({
      data: { garageId, clientId: tiers.id, licensePlate: 'ZZ-999-ZZ', make: 'Renault', model: 'Clio' },
    })
    const r = await portalCreer(req('/api/portal/tickets', {
      subject: 'Test', message: 'Test', vehicleId: sienne.id,
    }))
    expect(r.status).toBe(400)
    expect(await prisma.portalTicket.count()).toBe(0)
  })
})

describe('la correspondance client n\'est pas ouverte à tout le garage', () => {
  /**
   * Défaut trouvé en construisant l'interface : les deux routes du poste
   * n'exigeaient AUCUNE permission. Un mécanicien — dont le rôle ne porte ni
   * `customer:manage` ni `financial:read` — pouvait lire toutes les
   * conversations du garage, y compris les litiges de facturation, y répondre AU
   * NOM DU GARAGE (le message est signé de son nom), puis les clore.
   */
  it('un mécanicien ne lit pas la boîte du garage', async () => {
    await ouvrirFil()
    sess.role = 'MECHANIC'
    expect((await garageListe(req('/api/tickets'))).status).toBe(403)
  })

  it('un mécanicien ne lit ni ne répond à une conversation', async () => {
    const id = await ouvrirFil()
    sess.role = 'MECHANIC'
    expect((await garageFil(req(`/api/tickets/${id}`), { params: { id } })).status).toBe(403)
    expect((await garageAgir(req(`/api/tickets/${id}`, { message: 'Bonjour' }), { params: { id } })).status).toBe(403)
    expect((await garageAgir(req(`/api/tickets/${id}`, { close: true }), { params: { id } })).status).toBe(403)
    // Rien n'a été écrit, et le fil est resté ouvert.
    expect(await prisma.portalTicketMessage.count({ where: { ticketId: id } })).toBe(1)
    expect((await prisma.portalTicket.findUnique({ where: { id } })).status).toBe('open')
  })

  it('le comptoir, lui, y a bien accès', async () => {
    // La permission retenue est celle de la relation client : la refuser au
    // RECEPTIONIST rendrait la messagerie inutilisable là où elle sert le plus.
    const id = await ouvrirFil()
    sess.role = 'RECEPTIONIST'
    expect((await garageListe(req('/api/tickets'))).status).toBe(200)
    expect((await garageAgir(req(`/api/tickets/${id}`, { message: 'Bonjour' }), { params: { id } })).status).toBe(200)
  })
})

describe('validation', () => {
  it('un sujet ou un message vide est refusé', async () => {
    for (const corps of [
      { subject: '', message: 'x' },
      { subject: 'x', message: '' },
      { subject: '   ', message: '   ' },
    ]) {
      expect((await portalCreer(req('/api/portal/tickets', corps))).status).toBe(400)
    }
    expect(await prisma.portalTicket.count()).toBe(0)
  })

  it('une catégorie inconnue retombe sur « general » plutôt que de passer telle quelle', async () => {
    const r = await portalCreer(req('/api/portal/tickets', {
      subject: 'Sujet', message: 'Message', category: 'inexistante',
    }))
    expect((await r.json()).ticket.category).toBe('general')
  })

  it('sans session portail, rien n\'est lisible', async () => {
    const r = await portalListe(new NextRequest('http://localhost/api/portal/tickets'))
    expect(r.status).toBe(401)
  })
})

/**
 * ROUTE DE WEBHOOK — de bout en bout, base simulée.
 *
 * Ce qui est prouvé ici n'est pas « la route répond 200 » : c'est qu'AUCUNE
 * écriture n'a lieu sans signature valide, qu'un rejeu ne duplique pas
 * l'événement, et qu'un statut en retard ne fait pas régresser la facture.
 * La base est un simulacre minimal (mêmes opérations Prisma que le code réel).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'

const h = vi.hoisted(() => {
  const state: {
    transmissions: Array<Record<string, unknown>>
    events: Array<Record<string, unknown>>
    seq: number
    secret: string | null
    connexion: Record<string, unknown> | null
    providerId: string
    updates: number
    eventsCrees: number
    db: Record<string, unknown>
  } = {
    transmissions: [],
    events: [],
    seq: 0,
    secret: 'secret-webhook-de-test',
    connexion: { providerId: 'generic-pa', credentials: 'enveloppe', environment: 'sandbox' },
    providerId: 'generic-pa',
    updates: 0,
    eventsCrees: 0,
    db: {},
  }
  state.db = {
    eInvoiceTransmission: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.transmissions
          .filter((t) => t.providerId === where.providerId && t.externalId === where.externalId)
          .slice(0, 5),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.updates += 1
        const t = state.transmissions.find((x) => x.id === where.id)
        if (t) Object.assign(t, data)
        return t
      },
    },
    eInvoiceEvent: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.events.find((e) =>
          e.transmissionId === where.transmissionId && e.type === where.type && e.message === where.message,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.eventsCrees += 1
        const e = { id: `evt-${++state.seq}`, ...data }
        state.events.push(e)
        return e
      },
    },
  }
  return state
})

vi.mock('@/lib/db', () => ({
  isPostgresDatabase: () => true,
  serverPrisma: () => h.db,
}))
vi.mock('@/lib/einvoicing/connection', () => ({
  lireConnexion: async () => h.connexion,
  dechiffrer: () => (h.secret ? { webhookSecret: h.secret } : {}),
}))
vi.mock('@/lib/einvoicing/flags', () => ({ getEInvoicingFlags: () => ({ enabled: true }) }))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => '203.0.113.9',
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

import { POST } from '@/app/api/einvoicing/webhooks/[providerId]/route'

const SECRET = 'secret-webhook-de-test'

function requete(corps: string, options: { secret?: string | null; ts?: number; signature?: string; corpsSigne?: string } = {}) {
  const ts = options.ts ?? Math.floor(Date.now() / 1000)
  const secret = options.secret === undefined ? SECRET : options.secret
  const signe = options.corpsSigne ?? corps
  const signature = options.signature ?? (secret
    ? crypto.createHmac('sha256', secret).update(`${ts}.${signe}`).digest('hex')
    : '')
  return new Request('http://localhost/api/einvoicing/webhooks/generic-pa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gf-timestamp': String(ts),
      'x-gf-signature': signature,
    },
    body: corps,
  })
}

const appeler = (req: Request) => POST(req, { params: Promise.resolve({ providerId: 'generic-pa' }) })

const corps = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ externalId: 'EXT-1', status: 'accepted', eventId: 'evt-1', ...over })

beforeEach(() => {
  h.transmissions = [{
    id: 'tr-1', garageId: 'g-1', environment: 'sandbox',
    status: 'submitted', externalId: 'EXT-1', providerId: 'generic-pa',
  }]
  h.events = []
  h.seq = 0
  h.secret = SECRET
  h.connexion = { providerId: 'generic-pa', credentials: 'enveloppe', environment: 'sandbox' }
  h.updates = 0
  h.eventsCrees = 0
})

describe('POST /api/einvoicing/webhooks/[providerId]', () => {
  it('applique un statut signé et trace l’événement', async () => {
    const r = await appeler(requete(corps()))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, status: 'accepted' })
    expect(h.transmissions[0].status).toBe('accepted')
    expect(h.updates).toBe(1)
    expect(h.eventsCrees).toBe(1)
    expect(h.events[0]).toMatchObject({ type: 'webhook', status: 'accepted', message: 'evt-1' })
  })

  it('refuse un corps modifié et n’écrit RIEN', async () => {
    const r = await appeler(requete(corps({ status: 'paid' }), { corpsSigne: corps() }))
    expect(r.status).toBe(401)
    expect(await r.json()).toMatchObject({ ok: false, code: 'SIGNATURE_INVALIDE' })
    expect(h.updates).toBe(0)
    expect(h.eventsCrees).toBe(0)
    expect(h.transmissions[0].status).toBe('submitted')
  })

  it('refuse un mauvais secret et n’écrit RIEN', async () => {
    const r = await appeler(requete(corps(), { secret: 'mauvais-secret' }))
    expect(r.status).toBe(401)
    expect(h.updates).toBe(0)
  })

  it('refuse un rejeu hors de la fenêtre de 5 minutes', async () => {
    const r = await appeler(requete(corps(), { ts: Math.floor(Date.now() / 1000) - 301 }))
    expect(r.status).toBe(401)
    expect(h.updates).toBe(0)
  })

  it('ne duplique pas un événement déjà traité (même eventId)', async () => {
    expect((await appeler(requete(corps()))).status).toBe(200)
    const second = await appeler(requete(corps()))
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true })
    expect(h.eventsCrees).toBe(1)
    expect(h.updates).toBe(1)
  })

  it('ignore une régression sans toucher à la facture', async () => {
    h.transmissions[0].status = 'accepted'
    const r = await appeler(requete(corps({ status: 'submitted', eventId: 'evt-retard' })))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, ignored: true, status: 'accepted' })
    expect(h.transmissions[0].status).toBe('accepted')
    expect(h.updates).toBe(0)
    // L'événement est tout de même JOURNALISÉ : on saura qu'il est arrivé.
    expect(h.eventsCrees).toBe(1)
  })

  it('refuse un identifiant externe inconnu (404, pour arrêter les reprises)', async () => {
    h.transmissions = []
    const r = await appeler(requete(corps()))
    expect(r.status).toBe(404)
    expect(await r.json()).toMatchObject({ ok: false, code: 'UNKNOWN_TRANSMISSION' })
    expect(h.updates).toBe(0)
  })

  it('refuse un identifiant ambigu entre plusieurs garages', async () => {
    h.transmissions.push({ ...h.transmissions[0], id: 'tr-2', garageId: 'g-2' })
    const r = await appeler(requete(corps()))
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ ok: false, code: 'AMBIGUOUS_TRANSMISSION' })
    expect(h.updates).toBe(0)
  })

  it('refuse un webhook sans secret configuré (409, l’exploitant doit agir)', async () => {
    h.secret = null
    const r = await appeler(requete(corps(), { secret: null }))
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ ok: false, code: 'WEBHOOK_NOT_CONFIGURED' })
    expect(h.updates).toBe(0)
  })

  it('refuse une charge utile absente ou mal formée', async () => {
    const mal = await appeler(requete('{pas du json'))
    expect(mal.status).toBe(400)
    const incomplet = await appeler(requete(JSON.stringify({ externalId: 'EXT-1' })))
    expect(incomplet.status).toBe(400)
    expect(h.updates).toBe(0)
  })

  it('refuse une charge utile au-delà de 64 Kio', async () => {
    const gros = JSON.stringify({ externalId: 'EXT-1', status: 'accepted', bourrage: 'x'.repeat(70 * 1024) })
    const r = await appeler(requete(gros))
    expect(r.status).toBe(413)
    expect(h.updates).toBe(0)
  })
})

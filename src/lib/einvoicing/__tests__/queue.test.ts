/**
 * FILE DE REPRISE — politique de backoff et frontières de sécurité.
 *
 * Ce qui est verrouillé ici, dans l'ordre d'importance :
 *  1. une facture d'issue INCONNUE ou REFUSÉE n'est jamais reprise
 *     automatiquement (risque de double déclaration / boucle de refus) ;
 *  2. une transmission en échec n'est reprise qu'après le délai prévu ;
 *  3. la file s'arrête définitivement après cinq tentatives ;
 *  4. sans jeton configuré, la route ne fait RIEN (503) ;
 *  5. une exception sur une facture n'empêche pas de traiter les suivantes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  transmissions: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
  garage: { id: 'g-1', name: 'Garage', siret: null, vatNumber: null, address: null } as Record<string, unknown> | null,
  envois: [] as Array<Record<string, unknown>>,
  envoyerResultat: { ok: true, status: 'accepted', externalId: 'EXT-9' } as Record<string, unknown>,
  envoyerException: null as Error | null,
  db: {} as Record<string, unknown>,
}))

vi.mock('@/lib/db', () => ({
  isPostgresDatabase: () => true,
  serverPrisma: () => h.db,
}))
vi.mock('@/lib/einvoicing/submit', () => ({
  envoyerFacture: async (e: Record<string, unknown>) => {
    h.envois.push(e)
    if (h.envoyerException) throw h.envoyerException
    return h.envoyerResultat
  },
}))
vi.mock('@/lib/einvoicing/flags', () => ({
  getEInvoicingFlags: () => ({ enabled: true, outgoingEnabled: true }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('@/lib/money-db', () => ({
  linesToEuros: (lines: Array<Record<string, unknown>>) => lines,
}))

h.db = {
  eInvoiceTransmission: {
    findMany: async ({ take }: { take: number }) => h.transmissions.slice(0, take),
  },
  eInvoiceEvent: {
    count: async ({ where }: { where: Record<string, unknown> }) =>
      h.events.filter((e) => e.transmissionId === where.transmissionId && e.type === where.type).length,
  },
  invoice: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      h.invoices.find((i) => i.id === where.id && i.garageId === where.garageId) ?? null,
  },
  garage: {
    findUnique: async () => h.garage,
  },
}

import {
  BACKOFF_MS, MAX_TENTATIVES, delaiAvantEssai, decisionReprise, listerCandidats, traiterFile,
} from '@/lib/einvoicing/queue'
import { POST } from '@/app/api/internal/einvoicing/queue/route'

const MAINTENANT = Date.parse('2026-10-19T12:00:00Z')
const minutes = (n: number) => n * 60_000

beforeEach(() => {
  h.transmissions = []
  h.events = []
  h.invoices = [{ id: 'inv-1', garageId: 'g-1', number: 'F-1', issueDate: '2026-10-01', dueDate: null,
    taxRate: 20, clientName: 'Client', clientAddress: null, lines: [] }]
  h.garage = { id: 'g-1', name: 'Garage', siret: null, vatNumber: null, address: null }
  h.envois = []
  h.envoyerResultat = { ok: true, status: 'accepted', externalId: 'EXT-9' }
  h.envoyerException = null
  process.env.EINVOICING_QUEUE_TOKEN = 'jeton-de-file-de-32-caracteres-minimum'
})

describe('delaiAvantEssai — backoff exponentiel borné', () => {
  it('applique le premier palier après UN échec, puis la séquence documentée', () => {
    expect(delaiAvantEssai(1)).toBe(BACKOFF_MS[0])
    expect(BACKOFF_MS.map((_, i) => delaiAvantEssai(i + 1))).toEqual(BACKOFF_MS)
  })
  it('borne au dernier palier au-delà de la séquence', () => {
    expect(delaiAvantEssai(99)).toBe(BACKOFF_MS[BACKOFF_MS.length - 1])
  })
  it('traite les valeurs négatives comme le premier palier', () => {
    expect(delaiAvantEssai(-3)).toBe(BACKOFF_MS[0])
  })
})

describe('decisionReprise', () => {
  const etat = (over: Partial<{ status: string; externalId: string | null; tentatives: number; dernierEchec: string }> = {}) => ({
    status: 'error', externalId: null, tentatives: 1,
    dernierEchec: new Date(MAINTENANT - minutes(10)).toISOString(),
    ...over,
  })

  it('accepte un échec sans identifiant externe après le délai', () => {
    expect(decisionReprise(etat(), MAINTENANT)).toEqual({ ok: true })
  })

  it('refuse tant que le délai n’est pas écoulé', () => {
    const recent = etat({ dernierEchec: new Date(MAINTENANT - minutes(1)).toISOString() })
    expect(decisionReprise(recent, MAINTENANT)).toEqual({ ok: false, raison: 'DELAI_NON_ECOULE' })
  })

  it('refuse TOUT statut autre que `error` (unknown, pending, rejected…)', () => {
    for (const status of ['unknown', 'submission_pending', 'rejected', 'accepted', 'paid', 'draft']) {
      expect(decisionReprise(etat({ status }), MAINTENANT)).toEqual({ ok: false, raison: 'STATUT_NON_REJOUABLE' })
    }
  })

  it('refuse dès qu’un identifiant externe existe', () => {
    expect(decisionReprise(etat({ externalId: 'EXT-1' }), MAINTENANT)).toEqual({ ok: false, raison: 'IDENTIFIANT_EXTERNE' })
  })

  it('arrête après le nombre maximal de tentatives', () => {
    expect(decisionReprise(etat({ tentatives: MAX_TENTATIVES - 1 }), MAINTENANT + minutes(60 * 48)).ok).toBe(true)
    expect(decisionReprise(etat({ tentatives: MAX_TENTATIVES }), MAINTENANT + minutes(60 * 48)))
      .toEqual({ ok: false, raison: 'TENTATIVES_EPUISEES' })
  })

  it('n’accepte pas un horodatage illisible', () => {
    expect(decisionReprise(etat({ dernierEchec: 'pas-une-date' }), MAINTENANT))
      .toEqual({ ok: false, raison: 'DELAI_NON_ECOULE' })
  })
})

describe('listerCandidats / traiterFile', () => {
  const transmission = (over: Record<string, unknown> = {}) => ({
    id: 'tr-1', garageId: 'g-1', invoiceId: 'inv-1', providerId: 'generic-pa',
    environment: 'sandbox', status: 'error', externalId: null,
    updatedAt: new Date(MAINTENANT - minutes(10)), ...over,
  })

  it('ne retient que les échecs éligibles et respecte la limite', async () => {
    h.transmissions = [
      transmission({ id: 'tr-1' }),
      transmission({ id: 'tr-2', status: 'unknown' }),
      transmission({ id: 'tr-3', updatedAt: new Date(MAINTENANT - minutes(1)) }),
    ]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }]
    const candidats = await listerCandidats(10, MAINTENANT)
    expect(candidats.map((c) => c.transmissionId)).toEqual(['tr-1'])
    expect(candidats[0].tentatives).toBe(1)
  })

  it('reprend une facture publiée et transmet les données attendues', async () => {
    h.transmissions = [transmission()]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }]
    const r = await traiterFile(10, MAINTENANT)
    expect(r).toMatchObject({ examines: 1, repris: 1, reussis: 1, echoues: 0 })
    expect(h.envois).toHaveLength(1)
    expect(h.envois[0]).toMatchObject({
      garageId: 'g-1', invoiceId: 'inv-1', environment: 'sandbox', actorUserId: null,
    })
  })

  it('ignore une facture absente du cloud sans la compter comme reprise', async () => {
    h.transmissions = [transmission({ invoiceId: 'inconnue' })]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }]
    const r = await traiterFile(10, MAINTENANT)
    expect(r).toMatchObject({ examines: 1, repris: 0, ignores: 1 })
    expect(r.details[0]).toMatchObject({ code: 'INVOICE_NOT_PUBLISHED' })
  })

  it('compte un refus de la plateforme comme échec, jamais comme succès', async () => {
    h.transmissions = [transmission()]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }]
    h.envoyerResultat = { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'injoignable' }
    const r = await traiterFile(10, MAINTENANT)
    expect(r).toMatchObject({ repris: 1, reussis: 0, echoues: 1 })
  })

  it('une exception sur une facture n’arrête pas les suivantes', async () => {
    h.transmissions = [transmission({ id: 'tr-1' }), transmission({ id: 'tr-2', invoiceId: 'inv-2' })]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }, { transmissionId: 'tr-2', type: 'error' }]
    h.invoices.push({ ...h.invoices[0], id: 'inv-2' })
    let appel = 0
    h.envoyerException = null
    // La première lève, la seconde réussit.
    const original = h.envoyerResultat
    const db = h.db as { invoice: { findFirst: (a: { where: Record<string, unknown> }) => Promise<unknown> } }
    const vraiFind = db.invoice.findFirst
    db.invoice.findFirst = async (args: { where: Record<string, unknown> }) => {
      const r = await vraiFind(args)
      appel += 1
      if (appel === 1) throw new Error('panne simulée')
      return r
    }
    try {
      const r = await traiterFile(10, MAINTENANT)
      expect(r.examines).toBe(2)
      expect(r.echoues).toBe(1)
      expect(r.reussis).toBe(1)
      expect(r.details.some((d) => d.code === 'EXCEPTION')).toBe(true)
    } finally {
      db.invoice.findFirst = vraiFind
      h.envoyerResultat = original
    }
  })
})

describe('POST /api/internal/einvoicing/queue', () => {
  const TOKEN = 'jeton-de-file-de-32-caracteres-minimum'
  const requete = (options: { token?: string | null; body?: unknown } = {}) => {
    const entetes: Record<string, string> = { 'content-type': 'application/json' }
    if (options.token !== null) entetes.authorization = `Bearer ${options.token ?? TOKEN}`
    return new Request('http://localhost/api/internal/einvoicing/queue', {
      method: 'POST', headers: entetes, body: JSON.stringify(options.body ?? {}),
    })
  }

  it('refuse sans jeton configuré (503, aucune action)', async () => {
    delete process.env.EINVOICING_QUEUE_TOKEN
    const r = await POST(requete())
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ ok: false, code: 'QUEUE_NOT_CONFIGURED' })
    expect(h.envois).toHaveLength(0)
  })

  it('refuse un jeton absent ou faux (401, aucune action)', async () => {
    for (const token of [null, 'mauvais-jeton-de-32-caracteres-egalement']) {
      const r = await POST(requete({ token: token as string | null }))
      expect(r.status).toBe(401)
      expect(h.envois).toHaveLength(0)
    }
  })

  it('traite la file avec un jeton valide et borne la limite', async () => {
    h.transmissions = [{
      id: 'tr-1', garageId: 'g-1', invoiceId: 'inv-1', providerId: 'generic-pa',
      environment: 'sandbox', status: 'error', externalId: null,
      updatedAt: new Date(MAINTENANT - minutes(60)),
    }]
    h.events = [{ transmissionId: 'tr-1', type: 'error' }]
    const r = await POST(requete({ body: { limit: 9999 } }))
    expect(r.status).toBe(200)
    const corps = await r.json()
    expect(corps.ok).toBe(true)
    expect(corps.examines).toBe(1)
  })
})

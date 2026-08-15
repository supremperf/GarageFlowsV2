/**
 * Passerelle POSTE → CLOUD de la facturation électronique.
 *
 * Avant le 15/08/2026, quatre routes répondaient 501 SERVER_ONLY sur un poste
 * installé : la fonctionnalité était ANNONCÉE et INACCESSIBLE à tous les garages
 * qui travaillent sur poste. Ces tests vérifient que le remplacement tient ses
 * promesses — et surtout qu'il ne les tient PAS silencieusement quand il ne peut
 * pas : un garage doit distinguer « ma plateforme a refusé » de « le réseau
 * manque », les gestes à faire n'étant pas les mêmes.
 *
 * Base RÉELLE (SQLite) : la portée garage se prouve avec deux garages. Seul le
 * transport (`cloudPost`) est simulé — c'est lui qu'on ne peut pas exercer sans
 * service en ligne joignable.
 *
 * RÉSERVE : la chaîne complète poste → cloud → plateforme agréée reste
 * NOT_VERIFIED tant qu'aucun compte de plateforme de dématérialisation partenaire
 * n'est disponible (BLOCKED_EXTERNAL_REQUIREMENT).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-einvoice-bridge.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({
  licence: 'GF2.jeton-licence-test' as string | null,
  post: vi.fn(),
  role: 'OWNER',
  garageId: '',
}))

vi.mock('@/lib/sync/cloud-client', () => ({
  garageLicenseToken: async () => h.licence,
  cloudPost: (...a: unknown[]) => h.post(...a),
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'u-1', role: h.role, garageId: h.garageId } }),
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  clientIpFrom: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}))

let prisma: any
let relayerVersCloud: any
let factureLocale: any
let submitPOST: any
let submitGET: any
let testPOST: any
const ids = { garageA: '', garageB: '' }
const FACTURE = 'facture-pont-1'

/** Réponse « aboutie » du service en ligne. */
const reponseCloud = (status: number, data: unknown) => ({ ok: status < 400, status, data })

const poster = (corps: unknown) =>
  submitPOST(
    new Request('http://localhost/api/einvoicing/invoices/x/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
    }),
    { params: { id: FACTURE } },
  )

async function facture(over: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      id: FACTURE, garageId: ids.garageA, number: 'FAC-2026-200', status: 'sent',
      issueDate: '2026-08-15', clientName: 'Client Pont', taxRate: 20, ...over,
    },
  })
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ relayerVersCloud, factureLocale } = await import('@/lib/einvoicing/desktop-bridge'))
  const submit = (await import('@/app/api/einvoicing/invoices/[id]/submit/route')) as any
  submitPOST = submit.POST
  submitGET = submit.GET
  ;({ POST: testPOST } = (await import('@/app/api/einvoicing/connection/test/route')) as any)

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'pont-a' } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'pont-b' } })
  ids.garageA = a.id
  ids.garageB = b.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.licence = 'GF2.jeton-licence-test'
  h.role = 'OWNER'
  h.garageId = ids.garageA
  h.post.mockReset().mockResolvedValue(reponseCloud(200, { ok: true }))
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
})

describe('le poste dit la vérité sur ce qui s’est passé', () => {
  it('sans licence garage : refus explicite, aucun appel réseau', async () => {
    h.licence = null
    const r = await relayerVersCloud(ids.garageA, 'connection.get')
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('LICENCE_GARAGE_ABSENTE')
    expect(h.post, 'sans identité, il n’y a rien à demander').not.toHaveBeenCalled()
  })

  it('réseau absent : 503, et la facture reste enregistrée', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const r = await relayerVersCloud(ids.garageA, 'invoice.submit', { invoiceId: FACTURE })
    expect(r.status, 'un problème de transport n’est pas un refus de la plateforme').toBe(503)
    const corps = await r.json()
    expect(corps.code).toBe('NETWORK')
    expect(corps.error).toMatch(/reste enregistrée/)
  })

  it('délai dépassé : 503 également', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'TIMEOUT' })
    expect((await relayerVersCloud(ids.garageA, 'invoice.submit')).status).toBe(503)
  })

  it('un refus de la plateforme est rendu TEL QUEL, motif et statut compris', async () => {
    h.post.mockResolvedValue(reponseCloud(422, { ok: false, code: 'VALIDATION', message: 'SIRET absent' }))
    const r = await relayerVersCloud(ids.garageA, 'invoice.submit')
    expect(r.status).toBe(422)
    const corps = await r.json()
    expect(corps.code).toBe('VALIDATION')
    expect(corps.message, 'reformuler le motif priverait le garage du geste à faire').toBe('SIRET absent')
  })

  it('la licence accompagne chaque appel : l’identité ne vient pas du corps', async () => {
    await relayerVersCloud(ids.garageA, 'connection.get')
    expect(h.post.mock.calls[0][1]).toMatchObject({
      garageLicense: 'GF2.jeton-licence-test', action: 'connection.get',
    })
  })
})

describe('l’enrichissement local ne retouche jamais un refus', () => {
  it('une lecture aboutie reçoit la donnée que seul le poste connaît', async () => {
    h.post.mockResolvedValue(reponseCloud(200, { ok: true, transmissions: [] }))
    const r = await relayerVersCloud(ids.garageA, 'invoice.transmissions', {}, (d: any) => ({ ...d, ajout: 1 }))
    expect(await r.json()).toMatchObject({ ok: true, ajout: 1 })
  })

  it('un refus ressort intact — rien n’y est ajouté', async () => {
    h.post.mockResolvedValue(reponseCloud(409, { ok: false, code: 'NO_CONNECTION' }))
    const r = await relayerVersCloud(ids.garageA, 'invoice.transmissions', {}, (d: any) => ({ ...d, ajout: 1 }))
    expect(r.status).toBe(409)
    expect(await r.json(), 'retoucher un refus le rendrait illisible').toEqual({ ok: false, code: 'NO_CONNECTION' })
  })
})

describe('portée garage AVANT tout appel réseau', () => {
  it('une facture d’un autre garage est introuvable localement', async () => {
    await facture({ garageId: ids.garageB })
    expect(await factureLocale(ids.garageA, FACTURE)).toBeNull()
  })

  it('la route refuse 404 sans déranger le service en ligne', async () => {
    const r = await poster({})
    expect(r.status).toBe(404)
    expect(h.post, 'un identifiant inconnu ne doit pas devenir une sonde').not.toHaveBeenCalled()
  })
})

describe('les routes du poste délèguent au lieu de refuser (fin des 501)', () => {
  it('l’envoi d’une facture est relayé, pas refusé', async () => {
    await facture()
    const r = await poster({})
    expect(r.status, 'c’était un 501 SERVER_ONLY avant le 15/08/2026').not.toBe(501)
    expect(h.post.mock.calls[0][1]).toMatchObject({
      action: 'invoice.submit', payload: { invoiceId: FACTURE },
    })
  })

  it('un brouillon est refusé LOCALEMENT, sans aller-retour inutile', async () => {
    await facture({ status: 'draft' })
    const r = await poster({})
    expect((await r.json()).code).toBe('INVOICE_DRAFT')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('la relecture de statut est relayée sur l’action correspondante', async () => {
    await facture()
    await poster({ action: 'refresh-status', transmissionId: 't-42' })
    expect(h.post.mock.calls[0][1]).toMatchObject({
      action: 'invoice.status', payload: { transmissionId: 't-42' },
    })
  })

  it('la déclaration « non parvenue » a sa propre action', async () => {
    await facture()
    await poster({ action: 'declare-not-received', transmissionId: 't-42' })
    expect(h.post.mock.calls[0][1]).toMatchObject({
      action: 'invoice.not-received', payload: { transmissionId: 't-42' },
    })
  })

  it('sans transmissionId : 400, sans appel réseau', async () => {
    await facture()
    const r = await poster({ action: 'refresh-status' })
    expect(r.status).toBe(400)
    expect(h.post).not.toHaveBeenCalled()
  })

  it('la lecture des transmissions ajoute le droit d’émettre, calculé ici', async () => {
    h.post.mockResolvedValue(reponseCloud(200, { ok: true, transmissions: [], outgoingEnabled: true }))
    const r = await submitGET(new Request('http://localhost/x'), { params: { id: FACTURE } })
    expect(r.status).not.toBe(501)
    const corps = await r.json()
    expect(h.post.mock.calls[0][1]).toMatchObject({ action: 'invoice.transmissions' })
    // La licence identifie un GARAGE, pas un utilisateur : ce droit ne peut venir
    // que de la session locale.
    expect(corps.peutEmettre).toBe(true)
    expect(corps.outgoingEnabled, 'l’état de la fonctionnalité vient du service').toBe(true)
  })

  it('le test de connexion est relayé, pas refusé', async () => {
    const r = await testPOST(new Request('http://localhost/x', { method: 'POST' }), {})
    expect(r.status).not.toBe(501)
    expect(h.post.mock.calls[0][1]).toMatchObject({ action: 'connection.test' })
  })
})

describe('aucune route de facturation électronique ne répond plus 501', () => {
  it('le corpus est exempt de SERVER_ONLY', () => {
    const racine = path.resolve(__dirname, '../../../app/api/einvoicing')
    const fichiers: string[] = []
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) parcourir(p)
        else if (e.name === 'route.ts') fichiers.push(p)
      }
    }
    parcourir(racine)
    expect(fichiers.length, 'le corpus doit être non vide, sinon ce garde ne prouve rien')
      .toBeGreaterThan(0)
    for (const f of fichiers) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src, `${path.relative(racine, f)} refuse encore le poste`).not.toMatch(/status:\s*501/)
    }
  })
})

describe('un drapeau LOCAL ne doit jamais barrer la route au service', () => {
  // Régression du 15/08/2026, introduite avec le tunnel lui-même : `PUT`
  // testait `connectionsEnabled` AVANT de déléguer. Or un poste n'a jamais les
  // variables EINVOICING_* — le drapeau y vaut toujours faux. Aucun garage
  // installé ne pouvait donc enregistrer sa plateforme, alors que `DELETE`,
  // lui, déléguait avant le contrôle : on pouvait détruire une connexion sans
  // pouvoir la ressaisir. C'est le service qui décide, et il applique sa garde.
  let connectionPUT: any
  let statusGET: any

  beforeAll(async () => {
    ;({ PUT: connectionPUT } = (await import('@/app/api/einvoicing/connection/route')) as any)
    ;({ GET: statusGET } = (await import('@/app/api/einvoicing/status/route')) as any)
  })

  beforeEach(() => {
    // État d'un poste réel : aucune variable e-facturation provisionnée.
    delete process.env.EINVOICING_ENABLED
    delete process.env.EINVOICING_CONNECTIONS_ENABLED
  })

  const enregistrer = () =>
    connectionPUT(new Request('http://localhost/api/einvoicing/connection', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'generic-pa', authMode: 'api_key', apiKey: 'x' }),
    }), {})

  it('l’enregistrement d’une connexion est RELAYÉ, pas refusé', async () => {
    h.post.mockResolvedValue(reponseCloud(200, { ok: true, connection: { id: 'c-1' } }))
    const r = await enregistrer()
    expect(r.status, 'c’était un 409 FEATURE_DISABLED sur tout le parc installé').not.toBe(409)
    expect(h.post.mock.calls[0][1]).toMatchObject({ action: 'connection.put' })
  })

  it('les drapeaux affichés sont ceux du SERVICE, pas ceux du poste', async () => {
    h.post.mockResolvedValue(reponseCloud(200, {
      ok: true, flags: { enabled: true, connectionsEnabled: true, sandboxOnly: true, defaultEnvironment: 'sandbox' },
    }))
    const corps = await (await statusGET(new Request('http://localhost/api/einvoicing/status'), {})).json()
    expect(h.post.mock.calls[0][1]).toMatchObject({ action: 'flags.get' })
    expect(corps.flags.connectionsEnabled, 'le poste grisait le formulaire sur ses propres drapeaux').toBe(true)
    expect(corps.serviceInjoignable).toBe(false)
  })

  it('service injoignable : on le DIT, on ne prétend pas que c’est désactivé', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const corps = await (await statusGET(new Request('http://localhost/api/einvoicing/status'), {})).json()
    expect(corps.serviceInjoignable, 'les deux phrases appellent des gestes différents').toBe(true)
    expect(corps.flags.enabled, 'sans réponse, on n’annonce surtout pas « activé »').toBe(false)
  })
})

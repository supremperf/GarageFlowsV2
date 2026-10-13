/**
 * POST /api/sync/einvoicing — tunnel POSTE → CLOUD de la facturation
 * électronique.
 *
 * Ce que ces tests protègent : un poste installé n'atteint la facturation
 * électronique QUE par ce tunnel. Il est donc, du point de vue du service, un
 * client comme un autre — et une garantie qui reposerait sur le contrôle qu'il
 * veut bien faire avant d'appeler n'est pas une garantie. Chaque verrou de la
 * route de session doit exister ICI aussi.
 *
 * Ce qui est simulé, et pourquoi : les quatre modèles d'e-facturation n'existent
 * que dans le schéma PostgreSQL, inaccessibles depuis la base SQLite de test.
 * Sont donc remplacés les accès `serverPrisma()` et les fonctions terminales
 * (`envoyerFacture`, `supprimerConnexion`, …). `motifNonTransmissible` et
 * `peutEtreDeclareeNonParvenue` restent RÉELS : ce sont eux qu'on éprouve — les
 * simuler ferait passer ces tests même après la suppression du verrou.
 *
 * Les factures et les garages, eux, sont lus dans une base RÉELLE : la portée
 * garage se prouve avec deux garages, pas avec une carte en mémoire.
 *
 * RÉSERVE : l'envoi RÉEL vers une plateforme agréée reste NOT_VERIFIED — il
 * exige un compte sur une plateforme de dématérialisation partenaire.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-einvoicing.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({
  garageId: '',
  code: null as string | null,
  envoyer: vi.fn(),
  supprimerConnexion: vi.fn(),
  enregistrerConnexion: vi.fn(),
  lireConnexion: vi.fn(),
  tester: vi.fn(),
  transmissionsWhere: null as unknown,
}))

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

// Modèles PostgreSQL absents en SQLite : on capture les appels au lieu de les
// exécuter. `prisma` (facture, garage) reste la VRAIE base.
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  serverPrisma: () => ({
    eInvoiceAuditEvent: { create: async () => ({}) },
    eInvoiceTransmission: {
      findMany: async (a: { where: unknown }) => { h.transmissionsWhere = a.where; return [] },
    },
  }),
}))

// `motifNonTransmissible` et `peutEtreDeclareeNonParvenue` restent RÉELS.
vi.mock('@/lib/einvoicing/submit', async (orig) => ({
  ...(await orig() as Record<string, unknown>),
  envoyerFacture: (...a: unknown[]) => h.envoyer(...a),
  rafraichirStatut: async () => ({ ok: true, status: 'accepted' }),
  declarerNonParvenue: async () => ({ ok: true }),
}))
vi.mock('@/lib/einvoicing/connection', () => ({
  lireConnexion: (...a: unknown[]) => h.lireConnexion(...a),
  enregistrerConnexion: (...a: unknown[]) => h.enregistrerConnexion(...a),
  supprimerConnexion: (...a: unknown[]) => h.supprimerConnexion(...a),
  projeter: (l: unknown) => l,
  dechiffrer: () => ({ authMode: 'api_key' }),
}))
vi.mock('@/lib/einvoicing/test-connection', () => ({
  testerConnexion: (...a: unknown[]) => h.tester(...a),
}))

let prisma: any
let POST: (req: Request) => Promise<Response>
const ids = { garageA: '', garageB: '' }
const FACTURE = 'facture-einv-1'

const appeler = (action: string, payload: unknown = {}) =>
  POST(new Request('http://localhost/api/sync/einvoicing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.peu-importe', action, payload }),
  }))

/** Crée la facture publiée dans la base « cloud » de test. */
async function facture(over: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      id: FACTURE, garageId: ids.garageA, number: 'FAC-2026-100', status: 'sent',
      issueDate: '2026-08-15', clientName: 'Client Test', taxRate: 20,
      lines: {
        create: [{
          id: 'ligne-einv-1', description: 'Disques avant', sortOrder: 0, isLabor: false,
          quantityTenThousandths: 20_000, unitPriceTenThousandths: 455_000, unitCostTenThousandths: 210_000,
        }],
      },
      ...over,
    },
  })
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/einvoicing/route')) as any)

  const a = await prisma.garage.create({ data: { name: 'Garage A', slug: 'einv-a' } })
  const b = await prisma.garage.create({ data: { name: 'Garage B', slug: 'einv-b' } })
  ids.garageA = a.id
  ids.garageB = b.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.garageA
  h.code = null
  h.transmissionsWhere = null
  h.envoyer.mockReset().mockResolvedValue({ ok: true, transmissionId: 't-1' })
  h.supprimerConnexion.mockReset().mockResolvedValue(true)
  h.enregistrerConnexion.mockReset().mockResolvedValue({ id: 'c-1', clair: {} })
  h.lireConnexion.mockReset().mockResolvedValue(null)
  h.tester.mockReset().mockResolvedValue({ ok: true, status: 200 })
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  // Fonctionnalité ACTIVE par défaut dans ces tests : c'est l'état où les
  // verrous suivants ont un sens.
  process.env.EINVOICING_ENABLED = '1'
  process.env.EINVOICING_OUTGOING_ENABLED = '1'
  process.env.EINVOICING_CONNECTIONS_ENABLED = '1'
  delete process.env.EINVOICING_SANDBOX_ONLY
  delete process.env.EINVOICING_DEFAULT_ENVIRONMENT
})

describe('l’identité vient de la LICENCE, jamais du poste', () => {
  it('une licence refusée ne déclenche AUCUN travail', async () => {
    h.code = 'LICENSE_REVOKED'
    await facture()
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(r.status).toBe(403)
    expect(h.envoyer, 'une licence révoquée ne doit rien émettre').not.toHaveBeenCalled()
  })

  it('la facture d’un AUTRE garage est introuvable, pas refusée', async () => {
    await facture({ garageId: ids.garageB })
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    // Elle existe en base, mais pas pour CE garage : la réponse ne doit pas
    // confirmer son existence.
    expect((await r.json()).code).toBe('INVOICE_NOT_PUBLISHED')
    expect(h.envoyer).not.toHaveBeenCalled()
  })

  it('la lecture des transmissions est bornée au garage de la licence', async () => {
    await appeler('invoice.transmissions', { invoiceId: FACTURE })
    expect(h.transmissionsWhere, 'sans garageId, un poste lirait les transmissions d’un autre')
      .toEqual({ invoiceId: FACTURE, garageId: ids.garageA })
  })

  it('le poste ne choisit pas son environnement', async () => {
    process.env.EINVOICING_SANDBOX_ONLY = '1'
    await facture()
    await appeler('invoice.submit', { invoiceId: FACTURE, environment: 'production' })
    expect(h.envoyer.mock.calls[0][0].environment, 'une installation ne se déclare pas « production »')
      .toBe('sandbox')
  })
})

describe('les verrous de la route de session existent AUSSI ici', () => {
  it('émission désactivée : refus, sans appel à la plateforme', async () => {
    process.env.EINVOICING_OUTGOING_ENABLED = '0'
    await facture()
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('FEATURE_DISABLED')
    expect(h.envoyer, 'un interrupteur que le tunnel ignore n’est pas un interrupteur')
      .not.toHaveBeenCalled()
  })

  it('une facture en BROUILLON ne part pas', async () => {
    await facture({ status: 'draft' })
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('INVOICE_DRAFT')
    expect(h.envoyer, 'un brouillon n’est pas un document opposable').not.toHaveBeenCalled()
  })

  it('une facture ANNULÉE ne part pas', async () => {
    await facture({ status: 'cancelled' })
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('INVOICE_CANCELLED')
    expect(h.envoyer, 'la déclarer créerait une créance que le garage a retirée')
      .not.toHaveBeenCalled()
  })

  it('connexions désactivées : la DESTRUCTION des identifiants est bloquée', async () => {
    process.env.EINVOICING_CONNECTIONS_ENABLED = '0'
    const r = await appeler('connection.delete')
    expect(r.status).toBe(409)
    expect(h.supprimerConnexion, 'pouvoir détruire sans pouvoir ressaisir serait pire que tout')
      .not.toHaveBeenCalled()
  })

  it('fonctionnalité globalement coupée : tout est refusé', async () => {
    process.env.EINVOICING_ENABLED = '0'
    await facture()
    const r = await appeler('invoice.submit', { invoiceId: FACTURE })
    expect((await r.json()).code).toBe('EINVOICING_DISABLED')
    expect(h.envoyer).not.toHaveBeenCalled()
  })

  it('une action inconnue est refusée avant tout accès base', async () => {
    const r = await appeler('invoice.delete-everything', { invoiceId: FACTURE })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('UNKNOWN_ACTION')
  })
})

describe('le document transmis ne dépend pas du chemin emprunté', () => {
  it('les lignes arrivent avec les entiers exacts, pas des flottants', async () => {
    await facture()
    await appeler('invoice.submit', { invoiceId: FACTURE })
    const entrees = h.envoyer.mock.calls[0][0]
    expect(entrees.lines[0]).toMatchObject({
      description: 'Disques avant',
      quantityTenThousandths: 20_000,
      unitPriceTenThousandths: 455_000,
    })
  })

  it('l’identité transmise est celle de la licence', async () => {
    await facture()
    await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(h.envoyer.mock.calls[0][0].garageId).toBe(ids.garageA)
  })

  it('l’auteur reste nul : inventer une correspondance ferait mentir l’audit', async () => {
    await facture()
    await appeler('invoice.submit', { invoiceId: FACTURE })
    expect(h.envoyer.mock.calls[0][0].actorUserId).toBeNull()
  })
})

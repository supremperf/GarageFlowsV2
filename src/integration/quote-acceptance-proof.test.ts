/**
 * GF31-AUD-045 — l'accord du client sur un devis n'était qu'un changement de
 * statut.
 *
 * `POST /api/portal/quote/[token]` posait `status = 'accepted'` et rien d'autre :
 * aucune trace de QUAND, aucune liaison à CE QUI a été accepté, aucune
 * distinction avec un statut posé par le garage lui-même — qui peut l'écrire
 * directement via `PATCH /api/quotes/[id]`. En cas de litige sur une réparation,
 * il n'existait donc AUCUNE preuve, ni pour le client, ni pour le garage.
 *
 * Le dépôt disposait pourtant de tout le nécessaire (`buildSignableDocument`,
 * `createCertificate`, modèle `Signature` avec empreinte de contenu et sceau
 * HMAC) : il servait aux signatures dessinées, jamais à l'acceptation portail.
 *
 * §74 exige deux choses, vérifiées ici sur base SQLite réelle :
 *   1. la preuve est liée au CONTENU réellement accepté ;
 *   2. après modification du document, la preuve précédente n'est plus
 *      présentée comme valide.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { SignJWT } from 'jose'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-quote-proof.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.NEXTAUTH_SECRET = 'secret-de-test-suffisamment-long-pour-etre-accepte'
process.env.GF_PORTAL_SECRET = 'secret-portail-de-test-suffisamment-long-aussi'

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})
vi.mock('next/headers', () => ({
  headers: () => new Map([['user-agent', 'Mozilla/5.0 (test)'], ['x-forwarded-for', '198.51.100.7']]),
}))

let prisma: any
let portalGET: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
let portalPOST: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
let quotePATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let portalSecret: () => Uint8Array
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: portalGET, POST: portalPOST } = (await import('@/app/api/portal/quote/[token]/route')) as any)
  ;({ PATCH: quotePATCH } = (await import('@/app/api/quotes/[id]/route')) as any)
  ;({ portalSecret } = await import('@/lib/portal-secret'))

  garageId = (await prisma.garage.create({ data: { name: 'Preuve', slug: 'aud-045' } })).id
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.signature.deleteMany({ where: { garageId } })
  await prisma.quoteLine.deleteMany({})
  await prisma.quote.deleteMany({ where: { garageId } })
})

let compteur = 0
async function devis(): Promise<string> {
  compteur += 1
  const q = await prisma.quote.create({
    data: {
      garageId,
      number: `DEV-2026-${String(compteur).padStart(3, '0')}`,
      clientName: 'Client Réel',
      status: 'sent',
      taxRate: 20,
      issueDate: '2026-06-01',
      lines: {
        create: [{
          description: 'Vidange',
          quantityTenThousandths: 10000,
          unitPriceTenThousandths: 900000,
          unitCostTenThousandths: 400000,
          sortOrder: 0,
        }],
      },
    },
  })
  return q.id
}

async function jeton(quoteId: string): Promise<string> {
  return new SignJWT({ typ: 'quote-sign', quoteId, garageId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(portalSecret())
}

const lire = async (token: string) =>
  (await portalGET(new Request(`http://localhost/api/portal/quote/${token}`), { params: { token } })).json()

const repondre = (token: string, action: 'accept' | 'refuse') =>
  portalPOST(
    new Request(`http://localhost/api/portal/quote/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: { token } },
  )

const modifierDevis = (id: string, corps: Record<string, unknown>) =>
  quotePATCH(
    new Request(`http://localhost/api/quotes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  )

describe('GF31-AUD-045 — une acceptation produit une preuve', () => {
  it('accepter enregistre une signature liée au contenu, datée et circonstanciée', async () => {
    const id = await devis()
    const res = await repondre(await jeton(id), 'accept')
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.status).toBe('accepted')
    expect(corps.proof?.contentHash).toMatch(/^[0-9a-f]{64}$/)

    const preuve = await prisma.signature.findFirst({ where: { entityId: id } })
    expect(preuve).not.toBeNull()
    expect(preuve.entityType).toBe('quote')
    expect(preuve.signerRole).toBe('client')
    expect(preuve.contentHash).toBe(corps.proof.contentHash)
    expect(preuve.seal).toMatch(/^[0-9a-f]{64}$/)
    expect(preuve.ipAddress).toBe('198.51.100.7')
    expect(preuve.userAgent).toContain('test')
    // Le document accepté est conservé tel quel : c'est LUI qui fait foi.
    expect(JSON.parse(preuve.documentSnapshotJson).number).toBe('DEV-2026-001')
  })

  it('refuser produit également une trace opposable', async () => {
    const id = await devis()
    expect((await repondre(await jeton(id), 'refuse')).status).toBe(200)
    expect(await prisma.signature.count({ where: { entityId: id } })).toBe(1)
  })

  it('le statut et la preuve sont posés dans la MÊME transaction', async () => {
    // Deux réponses concurrentes : une seule doit aboutir, et il ne peut jamais
    // rester un devis « accepté » sans preuve, ni une preuve sans devis accepté.
    const id = await devis()
    const t = await jeton(id)
    const [a, b] = await Promise.all([repondre(t, 'accept'), repondre(t, 'refuse')])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await prisma.signature.count({ where: { entityId: id } })).toBe(1)
  })

  it('la lecture distingue un accord CLIENT d’un statut posé par le garage', async () => {
    const idClient = await devis()
    const tClient = await jeton(idClient)
    await repondre(tClient, 'accept')
    const vuClient = await lire(tClient)
    expect(vuClient.acceptation).not.toBeNull()
    expect(vuClient.acceptation.matchesCurrentDocument).toBe(true)
    expect(vuClient.acceptation.signerName).toBe('Client Réel')

    // Même statut, mais posé par le garage : aucune preuve.
    const idGarage = await devis()
    expect((await modifierDevis(idGarage, { status: 'accepted' })).status).toBe(200)
    const vuGarage = await lire(await jeton(idGarage))
    expect(vuGarage.status).toBe('accepted')
    expect(vuGarage.acceptation).toBeNull()
  })
})

describe('GF31-AUD-045 — une preuve périmée n’est plus présentée comme valide (§74)', () => {
  it('le garage ne peut PAS ramener un devis accepté en « envoyé »', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'accept')
    // La machine à états l'interdit déjà : c'est la garantie la plus forte.
    expect((await modifierDevis(id, { status: 'sent' })).status).toBe(409)
    expect((await lire(t)).acceptation).not.toBeNull()
  })

  it('transformer un accord en REFUS invalide la preuve d’accord', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'accept')
    expect((await lire(t)).acceptation).not.toBeNull()

    // Transition autorisée par la machine à états : sans invalidation, le garage
    // afficherait « refusé » tout en conservant la preuve que le client avait
    // accepté — deux vérités contradictoires en base.
    expect((await modifierDevis(id, { status: 'refused' })).status).toBe(200)
    const preuve = await prisma.signature.findFirst({ where: { entityId: id } })
    expect(preuve.invalidatedAt).not.toBeNull()   // marquée, jamais supprimée
    expect((await lire(t)).acceptation).toBeNull()
  })

  it('rouvrir un devis REFUSÉ invalide la preuve de refus', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'refuse')
    expect((await modifierDevis(id, { status: 'sent' })).status).toBe(200)
    expect((await prisma.signature.findFirst({ where: { entityId: id } })).invalidatedAt).not.toBeNull()
    expect((await lire(t)).acceptation).toBeNull()
  })

  it('convertir un devis accepté CONSERVE la preuve (suite naturelle de l’accord)', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'accept')
    expect((await modifierDevis(id, { status: 'converted' })).status).toBe(200)
    const preuve = await prisma.signature.findFirst({ where: { entityId: id } })
    expect(preuve.invalidatedAt).toBeNull()
    expect((await lire(t)).acceptation).not.toBeNull()
  })

  it('un contenu modifié après accord se voit : la preuve ne correspond plus', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'accept')

    // Champ resté modifiable sur un devis accepté (les LIGNES, elles, sont
    // verrouillées) : l'empreinte du document change donc.
    await prisma.quote.update({ where: { id }, data: { clientName: 'Autre Nom' } })

    const vu = await lire(t)
    expect(vu.acceptation).not.toBeNull()
    expect(vu.acceptation.matchesCurrentDocument).toBe(false)
  })

  it('une nouvelle réponse après réouverture crée une preuve neuve', async () => {
    const id = await devis()
    const t = await jeton(id)
    await repondre(t, 'refuse')
    await modifierDevis(id, { status: 'sent' })
    await repondre(t, 'accept')

    const preuves = await prisma.signature.findMany({ where: { entityId: id }, orderBy: { signedAt: 'asc' } })
    expect(preuves).toHaveLength(2)
    expect(preuves.filter((p: { invalidatedAt: Date | null }) => p.invalidatedAt === null)).toHaveLength(1)
  })
})

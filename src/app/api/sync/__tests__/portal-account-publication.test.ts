/**
 * POST /api/sync/portal-account — réception CLOUD d'un accès client publié.
 *
 * C'est un canal ouvert à des postes : un poste est un client comme un autre, et
 * une garantie qui reposerait sur le contrôle qu'il veut bien faire avant
 * d'appeler n'est pas une garantie. Ce qui est éprouvé ici :
 *
 *  · l'identité vient de la LICENCE, jamais du corps ;
 *  · une adresse déjà prise dans ce garage par un AUTRE compte est REFUSÉE —
 *    l'écraser reviendrait à s'approprier l'accès d'un client inscrit seul, et
 *    à le lui couper sans qu'il comprenne pourquoi ;
 *  · un compte ne change jamais de garage ;
 *  · la révocation des appareils coupe réellement les sessions ouvertes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-sync-portal-account.db')
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
const ids = { garageA: '', garageB: '' }
const COMPTE = 'compte-portail-1'

const publier = (account: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  POST(new Request('http://localhost/api/sync/portal-account', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.peu-importe', account, ...extra }),
  }))

const compteType = (over: Record<string, unknown> = {}) => ({
  id: COMPTE, email: 'client@example.test', passwordHash: '$2a$12$hachebcryptdetest0000000000000000000000000000000000000',
  name: 'Client Test', emailVerified: true, mustChangePassword: true,
  disabledAt: null, passwordChangedAt: null, ...over,
})

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/sync/portal-account/route')) as any)
  ids.garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'pa-a' } })).id
  ids.garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'pa-b' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.garageId = ids.garageA
  h.code = null
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
})

describe('l’identité vient de la licence', () => {
  it('une licence refusée n’écrit rien', async () => {
    h.code = 'LICENSE_REVOKED'
    const r = await publier(compteType())
    expect(r.status).toBe(403)
    expect(await prisma.portalUser.count({})).toBe(0)
  })

  it('le garage du compte créé est celui de la LICENCE', async () => {
    await publier(compteType({ garageId: ids.garageB }))
    const cree = await prisma.portalUser.findUnique({ where: { id: COMPTE }, select: { garageId: true } })
    expect(cree.garageId, 'un garageId présent dans le corps ne doit jamais servir d’identité')
      .toBe(ids.garageA)
  })

  it('la fiche client n’est pas publiée : aucun lien pendant', async () => {
    await publier(compteType({ clientId: 'client-du-poste' }))
    const cree = await prisma.portalUser.findUnique({ where: { id: COMPTE }, select: { clientId: true } })
    expect(cree.clientId, 'une clé étrangère pendante casserait la contrainte').toBeNull()
  })
})

describe('une adresse déjà prise n’est pas volée', () => {
  it('un AUTRE compte du même garage avec la même adresse : refus 409', async () => {
    await prisma.portalUser.create({
      data: { id: 'inscrit-seul', garageId: ids.garageA, email: 'client@example.test', passwordHash: 'x' },
    })
    const r = await publier(compteType())
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('EMAIL_TAKEN_CLOUD')
    // Le compte du client inscrit par lui-même est INTACT.
    const intact = await prisma.portalUser.findUnique({ where: { id: 'inscrit-seul' }, select: { passwordHash: true } })
    expect(intact.passwordHash, 'écraser lui couperait l’accès sans explication').toBe('x')
  })

  it('la même adresse dans un AUTRE garage ne gêne pas', async () => {
    await prisma.portalUser.create({
      data: { id: 'ailleurs', garageId: ids.garageB, email: 'client@example.test', passwordHash: 'x' },
    })
    expect((await publier(compteType())).status).toBe(200)
  })
})

describe('republier mène au même état, pas à un doublon', () => {
  it('deux publications successives ne créent qu’un compte', async () => {
    await publier(compteType())
    await publier(compteType({ name: 'Nom Corrigé' }))
    expect(await prisma.portalUser.count({})).toBe(1)
    const maj = await prisma.portalUser.findUnique({ where: { id: COMPTE }, select: { name: true } })
    expect(maj.name).toBe('Nom Corrigé')
  })

  it('le verrouillage par échecs de connexion est levé à la republication', async () => {
    await publier(compteType())
    await prisma.portalUser.update({
      where: { id: COMPTE }, data: { failedLoginCount: 5, lockedUntil: new Date('2030-01-01') },
    })
    await publier(compteType())
    const maj = await prisma.portalUser.findUnique({
      where: { id: COMPTE }, select: { failedLoginCount: true, lockedUntil: true },
    })
    expect(maj.failedLoginCount, 'un mot de passe remis doit rouvrir un compte verrouillé').toBe(0)
    expect(maj.lockedUntil).toBeNull()
  })
})

describe('couper les sessions en ligne', () => {
  it('`revoquerAppareils` révoque les appareils encore actifs', async () => {
    await publier(compteType())
    await prisma.portalDevice.create({
      data: { portalUserId: COMPTE, sessionId: 'session-1', userAgent: 'test' },
    })
    await publier(compteType(), { revoquerAppareils: true })
    const appareil = await prisma.portalDevice.findFirst({ where: { portalUserId: COMPTE } })
    expect(appareil.revokedAt, 'un cookie encore valide ouvrirait le portail malgré tout').not.toBeNull()
  })

  it('sans le drapeau, les sessions restent ouvertes', async () => {
    await publier(compteType())
    await prisma.portalDevice.create({
      data: { portalUserId: COMPTE, sessionId: 'session-2', userAgent: 'test' },
    })
    await publier(compteType())
    const appareil = await prisma.portalDevice.findFirst({ where: { portalUserId: COMPTE } })
    expect(appareil.revokedAt).toBeNull()
  })
})

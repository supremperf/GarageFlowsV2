/**
 * GF-PORT-001..004 — cycle de vie de l'accès portail client.
 *
 * Le portail n'avait AUCUNE gestion d'accès : le garage ne pouvait ni ouvrir un
 * compte, ni remettre un mot de passe, ni couper l'accès ; le client ne pouvait
 * pas changer le sien. L'unique chemin d'entrée était l'auto-inscription.
 *
 * Vraies routes, vraie base SQLite, vrai bcrypt. Seule la session garage est
 * simulée.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-portal-access.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-de-recette-suffisamment-long-0123456789'

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let accesGET: (req: Request, c: { params: { id: string } }) => Promise<Response>
let accesPOST: (req: Request, c: { params: { id: string } }) => Promise<Response>
let accesPUT: (req: Request, c: { params: { id: string } }) => Promise<Response>
let accesPATCH: (req: Request, c: { params: { id: string } }) => Promise<Response>
let prisma: any

let garageA: string, garageB: string
let clientA: string, clientSansEmail: string, clientB: string

const sessionDe = (garageId: string, role = 'OWNER') => ({ user: { id: 'u', name: 'A', role, garageId } })
const req = (corps?: unknown) =>
  new Request('http://x', corps === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) })

const ouvrir = (id: string) => accesPOST(req(), { params: { id } })
const reinitialiser = (id: string) => accesPUT(req(), { params: { id } })
const basculer = (id: string, actif: boolean) => accesPATCH(req({ actif }), { params: { id } })
const lire = (id: string) => accesGET(new Request('http://x'), { params: { id } })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: accesGET, POST: accesPOST, PUT: accesPUT, PATCH: accesPATCH } =
    (await import('@/app/api/clients/[id]/portal-access/route')) as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
  const mk = async (garageId: string, name: string, email: string | null) =>
    (await prisma.client.create({ data: { garageId, name, email } })).id
  clientA = await mk(garageA, 'Jean Dupont', 'Jean.Dupont@Exemple.FR')
  clientSansEmail = await mk(garageA, 'Sans Adresse', null)
  clientB = await mk(garageB, 'Bruno Blanc', 'bruno@exemple.fr')
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(() => { h.session = sessionDe(garageA) })

describe('ouverture de l\'accès par le garage', () => {
  it('crée l\'accès et rend le mot de passe temporaire UNE fois', async () => {
    const res = await ouvrir(clientA)
    expect(res.status).toBe(201)
    const corps = await res.json()

    expect(corps.exists).toBe(true)
    expect(corps.motDePasseTemporaire).toBe(true)
    expect(typeof corps.motDePasseTemporaireEnClair).toBe('string')
    expect(corps.motDePasseTemporaireEnClair.length).toBeGreaterThanOrEqual(14)

    // L'identifiant est NORMALISÉ en minuscules : sans cela « Jean.Dupont@… »
    // et « jean.dupont@… » créeraient deux accès dont un seul fonctionnerait.
    expect(corps.identifiant).toBe('jean.dupont@exemple.fr')

    // Le mot de passe n'est JAMAIS stocké en clair.
    const enBase = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    expect(enBase.passwordHash).not.toContain(corps.motDePasseTemporaireEnClair)
    expect(await bcrypt.compare(corps.motDePasseTemporaireEnClair, enBase.passwordHash)).toBe(true)
    expect(enBase.mustChangePassword).toBe(true)
  })

  it('la relecture ne redonne JAMAIS le mot de passe', async () => {
    const corps = await (await lire(clientA)).json()
    expect(corps.exists).toBe(true)
    expect(corps.motDePasseTemporaireEnClair).toBeUndefined()
    expect(JSON.stringify(corps)).not.toMatch(/passwordHash|hash/i)
  })

  it('refuse un client sans adresse e-mail, avec une consigne claire', async () => {
    const res = await ouvrir(clientSansEmail)
    expect(res.status).toBe(409)
    const corps = await res.json()
    expect(corps.code).toBe('CLIENT_SANS_EMAIL')
    expect(corps.error).toMatch(/e-mail/i)
  })

  it('refuse d\'ouvrir deux fois le même accès', async () => {
    const res = await ouvrir(clientA)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ACCESS_EXISTS')
  })

  it('deux ouvertures CONCURRENTES ne créent qu\'un seul accès', async () => {
    const c = (await prisma.client.create({ data: { garageId: garageA, name: 'Course', email: 'course@exemple.fr' } })).id
    const res = await Promise.all([ouvrir(c), ouvrir(c), ouvrir(c)])
    expect(res.filter((r) => r.status === 201)).toHaveLength(1)
    expect(await prisma.portalUser.count({ where: { clientId: c } })).toBe(1)
  })
})

describe('réinitialisation', () => {
  it('remet un mot de passe temporaire DIFFÉRENT et coupe les sessions', async () => {
    const acces = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    const ancienHash = acces.passwordHash
    // Une session ouverte, comme après une connexion du client.
    await prisma.portalDevice.create({ data: { portalUserId: acces.id, sessionId: `s-${Date.now()}` } })

    const corps = await (await reinitialiser(clientA)).json()
    expect(corps.motDePasseTemporaire).toBe(true)
    expect(typeof corps.motDePasseTemporaireEnClair).toBe('string')

    const apres = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    expect(apres.passwordHash).not.toBe(ancienHash)
    expect(apres.mustChangePassword).toBe(true)
    // Toute session encore ouverte tombe : c'est l'objet même d'une réinitialisation.
    expect(await prisma.portalDevice.count({ where: { portalUserId: acces.id, revokedAt: null } })).toBe(0)
  })

  it('débloque un compte verrouillé par des échecs de connexion', async () => {
    const acces = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    await prisma.portalUser.update({
      where: { id: acces.id },
      data: { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 3_600_000) },
    })
    await reinitialiser(clientA)
    const apres = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    expect(apres.failedLoginCount).toBe(0)
    expect(apres.lockedUntil).toBeNull()
  })

  it('refuse pour un client sans accès', async () => {
    const res = await reinitialiser(clientSansEmail)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('NO_ACCESS')
  })
})

describe('désactivation et réactivation', () => {
  it('désactiver coupe l\'accès ET les sessions ouvertes', async () => {
    const acces = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    await prisma.portalDevice.create({ data: { portalUserId: acces.id, sessionId: `s2-${Date.now()}` } })

    const corps = await (await basculer(clientA, false)).json()
    expect(corps.actif).toBe(false)

    const apres = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    expect(apres.disabledAt).toBeTruthy()
    // Couper l'accès sans couper les sessions ne couperait rien tant qu'un
    // cookie reste valide.
    expect(await prisma.portalDevice.count({ where: { portalUserId: acces.id, revokedAt: null } })).toBe(0)
  })

  it('le CLIENT MÉTIER et son historique survivent à la désactivation', async () => {
    // C'est la raison d'être de la désactivation : ne pas supprimer le client.
    expect(await prisma.client.count({ where: { id: clientA } })).toBe(1)
    expect(await prisma.portalUser.count({ where: { clientId: clientA } })).toBe(1)
  })

  it('réactiver rend l\'accès sans ressusciter les anciennes sessions', async () => {
    const acces = await prisma.portalUser.findFirst({ where: { clientId: clientA } })
    const corps = await (await basculer(clientA, true)).json()
    expect(corps.actif).toBe(true)
    expect((await prisma.portalUser.findFirst({ where: { clientId: clientA } })).disabledAt).toBeNull()
    // Le client se reconnecte : une session révoquée ne redevient jamais valide.
    expect(await prisma.portalDevice.count({ where: { portalUserId: acces.id, revokedAt: null } })).toBe(0)
  })

  it('`actif` doit être un booléen', async () => {
    for (const v of ['true', 1, null, {}]) {
      expect((await accesPATCH(req({ actif: v }), { params: { id: clientA } })).status).toBe(400)
    }
  })
})

describe('isolation entre garages et permissions', () => {
  it('le garage A ne peut pas ouvrir d\'accès pour un client du garage B', async () => {
    h.session = sessionDe(garageA)
    expect((await ouvrir(clientB)).status).toBe(404)
    expect(await prisma.portalUser.count({ where: { clientId: clientB } })).toBe(0)
  })

  it('le garage A ne peut ni lire, ni réinitialiser, ni désactiver l\'accès d\'un client du garage B', async () => {
    h.session = sessionDe(garageB)
    expect((await ouvrir(clientB)).status).toBe(201)

    h.session = sessionDe(garageA)
    expect((await lire(clientB)).status).toBe(404)
    expect((await reinitialiser(clientB)).status).toBe(404)
    expect((await basculer(clientB, false)).status).toBe(404)

    // L'accès du garage B est resté intact.
    const b = await prisma.portalUser.findFirst({ where: { clientId: clientB } })
    expect(b.disabledAt).toBeNull()
  })

  it('un rôle sans gestion ne peut rien modifier', async () => {
    h.session = sessionDe(garageA, 'MECHANIC')
    expect((await ouvrir(clientSansEmail)).status).toBe(403)
    expect((await reinitialiser(clientA)).status).toBe(403)
    expect((await basculer(clientA, false)).status).toBe(403)
    // …mais la LECTURE de l'état reste permise au personnel d'accueil.
    h.session = sessionDe(garageA, 'RECEPTIONIST')
    expect((await lire(clientA)).status).toBe(200)
  })
})

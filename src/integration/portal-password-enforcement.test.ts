/**
 * GF-PORT-002 / GF-PORT-003 — application côté SERVEUR des deux gardes du portail.
 *
 * Un accès coupé par le garage, et un mot de passe temporaire non encore changé,
 * doivent être opposés par le SERVEUR — pas seulement par une redirection
 * d'interface. Masquer un écran n'empêche personne d'appeler l'API directement.
 *
 * On exerce donc une VRAIE route protégée (`/api/portal/auth/me`) et la route de
 * changement de mot de passe, avec une vraie session portail signée.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-portal-enforce.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-application-des-gardes-0123456789abcdef'

let meGET: (req: NextRequest, ctx?: unknown) => Promise<Response>
let passwordPUT: (req: NextRequest, ctx?: unknown) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let prisma: any

let garageId: string
let userId: string
let sessionId: string
let cookie: string

const MOT_DE_PASSE = 'TemporaireInitial9'

/** Requête portant le cookie de session portail. */
const avecSession = (corps?: unknown) =>
  new NextRequest('http://localhost/api/portal/x', {
    method: corps === undefined ? 'GET' : 'PUT',
    headers: {
      cookie: `${PORTAL_COOKIE}=${cookie}`,
      ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: meGET } = (await import('@/app/api/portal/auth/me/route')) as any)
  ;({ PUT: passwordPUT } = (await import('@/app/api/portal/auth/password/route')) as any)
  const session = await import('@/lib/portal/session')
  signPortalSession = session.signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  const user = await prisma.portalUser.create({
    data: {
      garageId, email: 'client@exemple.fr', name: 'Jean',
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 10),
      emailVerified: true, mustChangePassword: true,
    },
  })
  userId = user.id
  sessionId = `sess-${Date.now()}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId } })
  cookie = await signPortalSession({ sub: userId, sid: sessionId, gid: garageId })
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.portalUser.update({
    where: { id: userId },
    data: {
      disabledAt: null, mustChangePassword: true,
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 10),
      passwordChangedAt: null,
    },
  })
  await prisma.portalDevice.updateMany({ where: { portalUserId: userId }, data: { revokedAt: null } })
})

describe('mot de passe TEMPORAIRE — aucune donnée servie avant changement', () => {
  it('une route protégée est refusée avec un code exploitable', async () => {
    const res = await meGET(avecSession())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('la route de CHANGEMENT reste accessible — sinon la contrainte serait indépassable', async () => {
    const res = await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: 'NouveauMotDePasse12' }))
    expect(res.status).toBe(200)
  })

  it('une fois le mot de passe défini, les données sont servies', async () => {
    await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: 'NouveauMotDePasse12' }))
    expect((await meGET(avecSession())).status).toBe(200)

    const apres = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(apres.mustChangePassword).toBe(false)
    expect(apres.passwordChangedAt).toBeTruthy()
  })
})

describe('changement de mot de passe — garanties', () => {
  it('exige le mot de passe ACTUEL, même quand il est temporaire', async () => {
    // Sans cela, un cookie volé suffirait à s'approprier le compte.
    const res = await passwordPUT(avecSession({ currentPassword: 'faux', newPassword: 'NouveauMotDePasse12' }))
    expect(res.status).toBe(403)
    expect((await prisma.portalUser.findUnique({ where: { id: userId } })).mustChangePassword).toBe(true)
  })

  it('refuse de réutiliser le mot de passe temporaire', async () => {
    const res = await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: MOT_DE_PASSE }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PASSWORD_UNCHANGED')
  })

  it('refuse un mot de passe trop court ou absurde', async () => {
    for (const v of ['court', '', '   ', null, 42, 'x'.repeat(200)]) {
      const res = await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: v }))
      expect(res.status, String(v)).toBe(400)
    }
  })

  it('révoque les AUTRES sessions mais conserve la sienne', async () => {
    const autre = `autre-${Date.now()}`
    await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId: autre } })

    await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: 'NouveauMotDePasse12' }))

    // L'autre appareil tombe…
    expect((await prisma.portalDevice.findUnique({ where: { sessionId: autre } })).revokedAt).toBeTruthy()
    // …la session courante survit, sinon l'utilisateur se déconnecterait lui-même.
    expect((await prisma.portalDevice.findUnique({ where: { sessionId } })).revokedAt).toBeNull()
    expect((await meGET(avecSession())).status).toBe(200)
  })
})

describe('accès DÉSACTIVÉ par le garage', () => {
  it('la session en cours cesse immédiatement de valoir', async () => {
    // Sans contrôle à chaque requête, un client écarté garderait l'accès
    // jusqu'à l'expiration de son cookie.
    await prisma.portalUser.update({ where: { id: userId }, data: { disabledAt: new Date(), mustChangePassword: false } })
    expect((await meGET(avecSession())).status).toBe(401)
  })

  it('même la route de changement de mot de passe est fermée', async () => {
    await prisma.portalUser.update({ where: { id: userId }, data: { disabledAt: new Date() } })
    const res = await passwordPUT(avecSession({ currentPassword: MOT_DE_PASSE, newPassword: 'NouveauMotDePasse12' }))
    expect(res.status).toBe(401)
  })

  it('réactiver ne suffit pas : la session révoquée reste morte', async () => {
    await prisma.portalUser.update({ where: { id: userId }, data: { disabledAt: new Date(), mustChangePassword: false } })
    await prisma.portalDevice.updateMany({ where: { portalUserId: userId }, data: { revokedAt: new Date() } })
    await prisma.portalUser.update({ where: { id: userId }, data: { disabledAt: null } })
    expect((await meGET(avecSession())).status).toBe(401)
  })
})

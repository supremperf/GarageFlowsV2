/**
 * GF-PORT-007 — l'adresse du client, dans les DEUX sens (§18 à §26).
 *
 * Deux adresses cohabitent : celle de la fiche tenue par le garage, et celle du
 * compte portail, qui est l'identifiant de connexion. Elles doivent rester
 * égales — sinon le garage écrit à l'une pendant que le client se connecte avec
 * l'autre, et rien ne le signale.
 *
 * Chacun des deux côtés peut la changer, mais pas au même prix : le client doit
 * PROUVER l'adresse (un cookie volé suffirait sinon à s'approprier le compte),
 * le garage l'applique tout de suite (il est l'émetteur de l'accès, et attendre
 * le clic d'un client qui ne relève plus son ancienne boîte laisserait la fiche
 * fausse indéfiniment). L'asymétrie porte sur la preuve exigée, jamais sur le
 * résultat.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-client-email.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-synchronisation-garage-0123456789abcdef'

const mails = vi.hoisted(() => ({ envoyes: [] as Array<{ to: string; text: string }> }))
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: { to: string; text: string }) => {
    mails.envoyes.push({ to: m.to, text: m.text })
    return { ok: true }
  },
}))

/** Session du garage — le rôle est variable, la portée garage ne l'est jamais. */
const sess = vi.hoisted(() => ({ role: 'OWNER', garageId: '', userId: 'u-garage' }))
vi.mock('@/lib/api-helpers', async () => {
  const reel = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers')
  return {
    ...reel,
    withAuth: (h: unknown) => h,
    requireSession: async () => ({
      user: { id: sess.userId, role: sess.role, garageId: sess.garageId, email: 'garage@test.fr' },
    }),
  }
})
vi.mock('@/lib/audit', () => ({
  logAudit: async (a: unknown) => { audits.push(a as Record<string, unknown>); },
}))
const audits: Array<Record<string, unknown>> = []

let clientPATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let verifyGET: (req: NextRequest) => Promise<Response>
let emailPUT: (req: NextRequest) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let prisma: any

let garageId: string, clientId: string, userId: string, sessionId: string, cookiePortail: string
const MDP = 'MotDePasseInitial9'
const ANCIENNE = 'jean@ancien.fr'
const NOUVELLE = 'jean@nouveau.fr'

const modifierFiche = (corps: unknown, id = clientId) =>
  clientPATCH(
    new NextRequest(`http://localhost/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  )

const compte = () => prisma.portalUser.findUnique({ where: { id: userId } })
const fiche = () => prisma.client.findUnique({ where: { id: clientId } })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PATCH: clientPATCH } = (await import('@/app/api/clients/[id]/route')) as any)
  ;({ GET: verifyGET } = (await import('@/app/api/portal/auth/verify-email/route')) as any)
  ;({ PUT: emailPUT } = (await import('@/app/api/portal/auth/email/route')) as any)
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Garage A', slug: 'a' } })).id
  sess.garageId = garageId
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  mails.envoyes = []
  audits.length = 0
  sess.role = 'OWNER'
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
  await prisma.client.deleteMany({})

  clientId = (await prisma.client.create({
    data: { garageId, name: 'Jean Dupont', email: ANCIENNE, phone: '0102030405' },
  })).id
  userId = (await prisma.portalUser.create({
    data: {
      garageId, clientId, email: ANCIENNE, name: 'Jean',
      passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true,
    },
  })).id
  sessionId = `s-${Math.random().toString(36).slice(2)}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId } })
  cookiePortail = await signPortalSession({ sub: userId, sid: sessionId, gid: garageId })
})

describe('le garage modifie l\'adresse (§20)', () => {
  it('la fiche ET l\'identifiant de connexion changent ensemble', async () => {
    const res = await modifierFiche({ email: NOUVELLE })
    expect(res.status).toBe(200)
    const corps = await res.json()

    expect((await fiche()).email).toBe(NOUVELLE)
    // §20 : le portail reflète la modification — c'est tout l'objet de ce lot.
    expect((await compte()).email).toBe(NOUVELLE)
    expect(corps.portail.identifiantModifie).toBe(true)
  })

  it('la preuve de vérification ne suit PAS la nouvelle adresse (§23)', async () => {
    await modifierFiche({ email: NOUVELLE })
    const u = await compte()
    // L'ancienne preuve portait sur l'ancienne adresse. La transporter serait
    // affirmer une vérification qui n'a jamais eu lieu.
    expect(u.emailVerified).toBe(false)
    expect(u.emailVerifyToken).toBeTruthy()
  })

  it('un lien de confirmation part sur la NOUVELLE adresse, et il fonctionne', async () => {
    await modifierFiche({ email: NOUVELLE })
    expect(mails.envoyes).toHaveLength(1)
    expect(mails.envoyes[0].to).toBe(NOUVELLE)

    const jeton = (await compte()).emailVerifyToken
    const res = await verifyGET(
      new NextRequest(`http://localhost/api/portal/auth/verify-email?token=${encodeURIComponent(jeton)}`),
    )
    expect(res.status).toBe(303)
    expect((await compte()).emailVerified).toBe(true)
  })

  it('les sessions ouvertes tombent — l\'identifiant a changé (§21)', async () => {
    await modifierFiche({ email: NOUVELLE })
    const d = await prisma.portalDevice.findFirst({ where: { sessionId } })
    expect(d.revokedAt).not.toBeNull()

    // Et le cookie émis pour l'ancienne identité ne rouvre rien.
    const res = await emailPUT(new NextRequest('http://localhost/api/portal/auth/email', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookiePortail}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ailleurs@test.fr', currentPassword: MDP }),
    }))
    expect(res.status).toBe(401)
  })

  it('le mot de passe n\'est pas touché : seul l\'identifiant change', async () => {
    const avant = (await compte()).passwordHash
    await modifierFiche({ email: NOUVELLE })
    expect((await compte()).passwordHash).toBe(avant)
  })

  it('modifier le nom ou le téléphone ne touche ni au compte ni aux sessions', async () => {
    const res = await modifierFiche({ name: 'Jean Dupont-Martin', phone: '0605040302' })
    expect(res.status).toBe(200)
    expect((await res.json()).portail).toBeUndefined()

    expect((await fiche()).name).toBe('Jean Dupont-Martin')
    expect((await compte()).email).toBe(ANCIENNE)
    expect((await compte()).emailVerified).toBe(true)
    expect((await prisma.portalDevice.findFirst({ where: { sessionId } })).revokedAt).toBeNull()
    expect(mails.envoyes).toHaveLength(0)
  })

  it('réenregistrer la MÊME adresse ne coupe rien', async () => {
    // Sans cette garde, ouvrir la fiche et cliquer « Enregistrer » déconnectait
    // le client et invalidait sa vérification, sans que rien n'ait changé.
    await modifierFiche({ email: ANCIENNE.toUpperCase(), name: 'Jean D.' })
    const u = await compte()
    expect(u.emailVerified).toBe(true)
    expect((await prisma.portalDevice.findFirst({ where: { sessionId } })).revokedAt).toBeNull()
  })

  it('un client SANS accès portail se modifie sans effet de bord', async () => {
    const seul = await prisma.client.create({ data: { garageId, name: 'Sans accès', email: 'seul@test.fr' } })
    const res = await modifierFiche({ email: 'seul2@test.fr' }, seul.id)
    expect(res.status).toBe(200)
    expect((await res.json()).portail).toBeUndefined()
    expect(mails.envoyes).toHaveLength(0)
  })
})

describe('collision d\'adresses (§22)', () => {
  it('deux clients du même garage ne peuvent pas partager un identifiant portail', async () => {
    const b = await prisma.client.create({ data: { garageId, name: 'Client B', email: 'b@test.fr' } })
    await prisma.portalUser.create({
      data: { garageId, clientId: b.id, email: 'b@test.fr', passwordHash: 'x', emailVerified: true },
    })

    const res = await modifierFiche({ email: 'b@test.fr' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('EMAIL_TAKEN')

    // Refus AVANT toute écriture : la fiche n'a pas bougé non plus, sinon les
    // deux vérités divergeraient sur-le-champ.
    expect((await fiche()).email).toBe(ANCIENNE)
    expect((await compte()).email).toBe(ANCIENNE)
  })

  it('la même adresse dans un AUTRE garage n\'est pas un conflit', async () => {
    const autre = (await prisma.garage.create({ data: { name: 'B', slug: `b-${Date.now()}` } })).id
    await prisma.portalUser.create({
      data: { garageId: autre, email: NOUVELLE, passwordHash: 'x', emailVerified: true },
    })
    expect((await modifierFiche({ email: NOUVELLE })).status).toBe(200)
  })
})

describe('conflit entre les deux sens (§25)', () => {
  it('une demande du client encore en attente est ANNULÉE par la correction du garage', async () => {
    // Le client demande jean@perso.fr ; avant qu'il confirme, le garage corrige
    // vers jean@nouveau.fr. Laisser courir le jeton du client permettrait de
    // confirmer plus tard une adresse décidée AVANT la correction — deux états
    // acceptés en silence.
    const demande = await emailPUT(new NextRequest('http://localhost/api/portal/auth/email', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookiePortail}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jean@perso.fr', currentPassword: MDP }),
    }))
    expect(demande.status).toBe(200)
    const jetonClient = (await compte()).emailVerifyToken
    expect((await compte()).pendingEmail).toBe('jean@perso.fr')

    await modifierFiche({ email: NOUVELLE })

    const u = await compte()
    expect(u.pendingEmail).toBeNull()
    expect(u.email).toBe(NOUVELLE)
    // L'ancien jeton ne vaut plus rien : il a été remplacé.
    expect(u.emailVerifyToken).not.toBe(jetonClient)
    const res = await verifyGET(
      new NextRequest(`http://localhost/api/portal/auth/verify-email?token=${encodeURIComponent(jetonClient)}`),
    )
    expect(res.status).toBe(400)
    expect((await compte()).email).toBe(NOUVELLE)
  })

  it('le journal d\'audit dit ce qui a été annulé (§26)', async () => {
    await emailPUT(new NextRequest('http://localhost/api/portal/auth/email', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookiePortail}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jean@perso.fr', currentPassword: MDP }),
    }))
    await modifierFiche({ email: NOUVELLE })

    const extra = (audits.at(-1) as any).details.extra
    expect(extra.emailAvant).toBe(ANCIENNE)
    expect(extra.emailApres).toBe(NOUVELLE)
    expect(extra.identifiantAvant).toBe(ANCIENNE)
    expect(extra.emailVerifieRemisAZero).toBe(true)
    expect(extra.sessionsCoupees).toBe(true)
    expect(extra.demandeClientAnnulee).toBe('jean@perso.fr')
  })
})

describe('le sens portail → garage reste branché (§24)', () => {
  it('la confirmation du client remonte toujours à la fiche du garage', async () => {
    await emailPUT(new NextRequest('http://localhost/api/portal/auth/email', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookiePortail}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: NOUVELLE, currentPassword: MDP }),
    }))
    const jeton = (await compte()).emailVerifyToken
    await verifyGET(new NextRequest(`http://localhost/api/portal/auth/verify-email?token=${encodeURIComponent(jeton)}`))

    expect((await compte()).email).toBe(NOUVELLE)
    // C'est la fiche du garage qui doit suivre : c'est elle qu'il consulte pour
    // écrire à son client.
    expect((await fiche()).email).toBe(NOUVELLE)
  })
})

describe('portée et permissions', () => {
  it('un client d\'un AUTRE garage est introuvable, pas refusé', async () => {
    const autre = (await prisma.garage.create({ data: { name: 'C', slug: `c-${Date.now()}` } })).id
    const etranger = await prisma.client.create({ data: { garageId: autre, name: 'Étranger', email: 'x@y.fr' } })
    const res = await modifierFiche({ email: 'z@y.fr' }, etranger.id)
    expect(res.status).toBe(404)
    expect((await prisma.client.findUnique({ where: { id: etranger.id } })).email).toBe('x@y.fr')
  })

  it('un mécanicien ne modifie pas une fiche client', async () => {
    sess.role = 'MECHANIC'
    expect((await modifierFiche({ email: NOUVELLE })).status).toBe(403)
    expect((await fiche()).email).toBe(ANCIENNE)
  })

  it('une adresse invalide est refusée avant toute écriture', async () => {
    expect((await modifierFiche({ email: 'pas-une-adresse' })).status).toBe(400)
    expect((await fiche()).email).toBe(ANCIENNE)
    expect((await compte()).emailVerified).toBe(true)
  })
})

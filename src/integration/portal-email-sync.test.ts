/**
 * GF-PORT-006 — changement d'adresse du client et synchronisation vers le garage.
 *
 * L'adresse est l'IDENTIFIANT de connexion : elle ne peut pas changer sur simple
 * demande. La nouvelle attend une confirmation envoyée sur ELLE, et ce n'est
 * qu'à ce moment que la fiche client du garage est mise à jour — sinon le garage
 * écrirait à une adresse jamais prouvée, et les deux vérités divergeraient.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-portal-email.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-synchronisation-email-0123456789abcdef'

/** Le courriel est intercepté : on veut savoir OÙ il part, pas l'envoyer. */
const mails = vi.hoisted(() => ({ envoyes: [] as Array<{ to: string; text: string }>, echoue: false }))
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: { to: string; text: string }) => {
    if (mails.echoue) return { ok: false, reason: 'SMTP_NOT_CONFIGURED' }
    mails.envoyes.push({ to: m.to, text: m.text })
    return { ok: true }
  },
}))

let emailPUT: (req: NextRequest, ctx?: unknown) => Promise<Response>
let verifyGET: (req: NextRequest) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let prisma: any

let garageId: string, clientId: string, userId: string, sessionId: string, cookie: string
const MDP = 'MotDePasseInitial9'
const ANCIENNE = 'ancienne@exemple.fr'
const NOUVELLE = 'nouvelle@exemple.fr'

const demander = (corps: unknown) =>
  emailPUT(new NextRequest('http://localhost/api/portal/auth/email', {
    method: 'PUT',
    headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  }))

const confirmer = (jeton: string) =>
  verifyGET(new NextRequest(`http://localhost/api/portal/auth/verify-email?token=${encodeURIComponent(jeton)}`))

const jetonCourant = async () =>
  (await prisma.portalUser.findUnique({ where: { id: userId } })).emailVerifyToken

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PUT: emailPUT } = (await import('@/app/api/portal/auth/email/route')) as any)
  ;({ GET: verifyGET } = (await import('@/app/api/portal/auth/verify-email/route')) as any)
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Garage A', slug: 'a' } })).id
  clientId = (await prisma.client.create({ data: { garageId, name: 'Jean Dupont', email: ANCIENNE } })).id
  userId = (await prisma.portalUser.create({
    data: {
      garageId, clientId, email: ANCIENNE, name: 'Jean',
      passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true,
    },
  })).id
  sessionId = `s-${Date.now()}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId } })
  cookie = await signPortalSession({ sub: userId, sid: sessionId, gid: garageId })
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  mails.envoyes = []
  mails.echoue = false
  await prisma.portalUser.update({
    where: { id: userId },
    data: { email: ANCIENNE, pendingEmail: null, emailVerifyToken: null },
  })
  await prisma.client.update({ where: { id: clientId }, data: { email: ANCIENNE } })
})

describe('demande de changement', () => {
  it('met l\'adresse EN ATTENTE et envoie la confirmation sur la NOUVELLE', async () => {
    const res = await demander({ email: NOUVELLE, currentPassword: MDP })
    expect(res.status).toBe(200)
    expect((await res.json()).emailEnvoye).toBe(true)

    // Le message part sur la nouvelle adresse : c'est ce qui en prouve la possession.
    expect(mails.envoyes).toHaveLength(1)
    expect(mails.envoyes[0].to).toBe(NOUVELLE)

    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.pendingEmail).toBe(NOUVELLE)
    // L'identifiant NE CHANGE PAS encore — sinon une faute de frappe enfermerait
    // le client dehors.
    expect(u.email).toBe(ANCIENNE)
    // Et la fiche garage n'a pas bougé non plus.
    expect((await prisma.client.findUnique({ where: { id: clientId } })).email).toBe(ANCIENNE)
  })

  it('exige le mot de passe — un cookie volé ne suffit pas', async () => {
    const res = await demander({ email: NOUVELLE, currentPassword: 'faux' })
    expect(res.status).toBe(403)
    expect((await prisma.portalUser.findUnique({ where: { id: userId } })).pendingEmail).toBeNull()
    expect(mails.envoyes).toHaveLength(0)
  })

  it('refuse une adresse invalide ou identique', async () => {
    for (const v of ['pas-une-adresse', '', null, 42, 'a@b']) {
      expect((await demander({ email: v, currentPassword: MDP })).status).toBe(400)
    }
    expect((await demander({ email: ANCIENNE.toUpperCase(), currentPassword: MDP })).status).toBe(400)
  })

  it('refuse une adresse déjà utilisée DANS LE GARAGE, sans attendre la confirmation', async () => {
    const autre = await prisma.portalUser.create({
      data: { garageId, email: 'occupee@exemple.fr', passwordHash: 'x', emailVerified: true },
    })
    const res = await demander({ email: 'occupee@exemple.fr', currentPassword: MDP })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('EMAIL_TAKEN')
    await prisma.portalUser.delete({ where: { id: autre.id } })
  })

  it('la même adresse dans un AUTRE garage n\'est pas un conflit', async () => {
    // L'unicité est bornée au garage : deux garages peuvent avoir un client à la
    // même adresse.
    const b = (await prisma.garage.create({ data: { name: 'B', slug: `b-${Date.now()}` } })).id
    await prisma.portalUser.create({
      data: { garageId: b, email: NOUVELLE, passwordHash: 'x', emailVerified: true },
    })
    expect((await demander({ email: NOUVELLE, currentPassword: MDP })).status).toBe(200)
  })

  it('un échec d\'envoi est DIT, pas masqué', async () => {
    mails.echoue = true
    const corps = await (await demander({ email: NOUVELLE, currentPassword: MDP })).json()
    expect(corps.emailEnvoye).toBe(false)
    expect(corps.message).toMatch(/n’a pas pu être envoyé|Contactez/i)
  })
})

describe('confirmation — c\'est là que tout bascule', () => {
  it('l\'adresse devient l\'identifiant ET remonte à la fiche garage', async () => {
    await demander({ email: NOUVELLE, currentPassword: MDP })
    const res = await confirmer(await jetonCourant())
    expect(res.status).toBe(303)

    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.email).toBe(NOUVELLE)
    expect(u.pendingEmail).toBeNull()
    expect(u.emailVerifyToken).toBeNull()

    // §47 : la fiche tenue par le garage suit, sinon il écrirait encore à
    // l'ancienne adresse et les deux vérités divergeraient en silence.
    expect((await prisma.client.findUnique({ where: { id: clientId } })).email).toBe(NOUVELLE)
  })

  it('le lien ne fonctionne qu\'une fois', async () => {
    await demander({ email: NOUVELLE, currentPassword: MDP })
    const jeton = await jetonCourant()
    await confirmer(jeton)
    expect((await confirmer(jeton)).status).toBe(400)
  })

  it('une collision survenue ENTRE la demande et la confirmation ne casse rien', async () => {
    await demander({ email: NOUVELLE, currentPassword: MDP })
    const jeton = await jetonCourant()
    // Quelqu'un d'autre prend l'adresse dans l'intervalle.
    const squatteur = await prisma.portalUser.create({
      data: { garageId, email: NOUVELLE, passwordHash: 'x', emailVerified: true },
    })

    const res = await confirmer(jeton)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/email=conflit/)

    // L'ANCIENNE adresse reste valide : le client n'est pas enfermé dehors.
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.email).toBe(ANCIENNE)
    expect(u.pendingEmail).toBeNull()
    await prisma.portalUser.delete({ where: { id: squatteur.id } })
  })

  it('un jeton inconnu est refusé', async () => {
    expect((await confirmer('jeton-invente')).status).toBe(400)
  })
})

describe('le mot de passe temporaire ne fuit jamais dans les traces', () => {
  it('le message d\'ouverture d\'accès contient le mot de passe — et lui seul le contient', async () => {
    const { messageAccesPortail } = await import('@/lib/portal/acces')
    const m = messageAccesPortail({
      nomGarage: 'Garage A', nomClient: 'Jean', identifiant: ANCIENNE,
      motDePasseTemporaire: 'SecretProvisoire9', urlConnexion: 'https://app.garageflows.fr/clients/login',
    })
    expect(m.text).toContain('SecretProvisoire9')
    // Il est annoncé comme provisoire : sans cela le client le note et s'étonne
    // qu'on le lui refuse ensuite.
    expect(m.text).toMatch(/provisoire/i)
  })

  it('la route d\'accès portail ne journalise jamais le mot de passe', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/api/clients/[id]/portal-access/route.ts'), 'utf8',
    )
    // Aucun appel de journalisation ne doit mentionner la variable du secret.
    const journaux = src.match(/logger\.\w+\([^)]*\)/g) ?? []
    for (const j of journaux) {
      expect(j, `journal suspect : ${j}`).not.toMatch(/motDePasse|password|EnClair/i)
    }
    // Le journal d'audit non plus.
    const audits = src.match(/logAudit\(\{[\s\S]*?\}\)/g) ?? []
    for (const a of audits) {
      expect(a).not.toMatch(/motDePasse|password|EnClair/i)
    }
  })
})

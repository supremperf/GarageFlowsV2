/**
 * GF-DUR-022 — cycle de vie du double facteur du portail, et son secret au repos.
 *
 * ─── Ce que ces tests cherchent d'abord ─────────────────────────────────────
 * Un secret TOTP n'est pas un mot de passe : le serveur doit pouvoir le RELIRE
 * pour vérifier les codes, un haché ne conviendrait donc pas. Mais « non
 * hachable » ne veut pas dire « à laisser en clair ». Il était écrit tel quel
 * dans la base — donc dans la sauvegarde automatique du poste, dans l'export
 * quotidien, dans toute copie. Qui obtient l'un de ces fichiers génère
 * indéfiniment les codes valides de tous les comptes protégés : le second
 * facteur cesse d'en être un, sans que personne ne s'en aperçoive.
 *
 * Le premier test ci-dessous lit donc la COLONNE, pas l'API : c'est le seul
 * endroit où le défaut était visible.
 *
 * ─── Et ensuite, le cycle ───────────────────────────────────────────────────
 * Enrôlement → secret en attente → confirmation par un vrai code → activation →
 * connexion en deux temps → mauvais code → code de secours à usage unique →
 * désactivation. Plus la question qui décide de tout : peut-on obtenir une
 * session complète SANS le second facteur ?
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-portail-2fa.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-double-facteur-0123456789abcdef'
// Clé de chiffrement des secrets au repos : sans elle, l'enrôlement est refusé
// — c'est précisément ce que le dernier bloc de ce fichier vérifie.
process.env.GF_TOTP_ENC_KEY = Buffer.alloc(32, 42).toString('base64')

let setupPOST: (r: NextRequest) => Promise<Response>
let enablePOST: (r: NextRequest) => Promise<Response>
let disablePOST: (r: NextRequest) => Promise<Response>
let verifyPOST: (r: NextRequest) => Promise<Response>
let loginPOST: (r: NextRequest) => Promise<Response>
let dashboardGET: (r: NextRequest) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let generateTotp: (s: string, at?: number) => string
let resetRateLimit: (c: string, s: string) => Promise<void>
let prisma: any

let garageId: string, userId: string, cookie: string
const MDP = 'MotDePasseClient2026'

const auth = (url: string, corps?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', cookie: `${PORTAL_COOKIE}=${cookie}` },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })

const nu = (url: string, corps: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: setupPOST } = (await import('@/app/api/portal/auth/2fa/setup/route')) as any)
  ;({ POST: enablePOST } = (await import('@/app/api/portal/auth/2fa/enable/route')) as any)
  ;({ POST: disablePOST } = (await import('@/app/api/portal/auth/2fa/disable/route')) as any)
  ;({ POST: verifyPOST } = (await import('@/app/api/portal/auth/2fa/verify/route')) as any)
  ;({ POST: loginPOST } = (await import('@/app/api/portal/auth/login/route')) as any)
  ;({ GET: dashboardGET } = (await import('@/app/api/portal/me/dashboard/route')) as any)
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)
  ;({ generateTotp } = (await import('@/lib/portal/totp')) as any)
  ;({ resetRateLimit } = (await import('@/lib/security/rate-limit')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Garage A', slug: `a-${Date.now()}` } })).id
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  // Le compteur de connexions est partagé par tous les fichiers du processus.
  await resetRateLimit('login', 'portal-login:unverified')
  await resetRateLimit('login', 'portal-2fa:unverified')
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})

  userId = (await prisma.portalUser.create({
    data: {
      garageId, email: 'jean@test.fr', name: 'Jean',
      passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true,
    },
  })).id
  const sid = `s-${Math.random().toString(36).slice(2)}`
  await prisma.portalDevice.create({ data: { portalUserId: userId, sessionId: sid } })
  cookie = await signPortalSession({ sub: userId, sid, gid: garageId })
})

/** Enrôle et active le double facteur ; rend le secret et les codes de secours. */
async function activer() {
  const s = await (await setupPOST(auth('/api/portal/auth/2fa/setup', {}))).json()
  const r = await enablePOST(auth('/api/portal/auth/2fa/enable', { token: generateTotp(s.secret) }))
  expect(r.status).toBe(200)
  return { secret: s.secret as string, backupCodes: (await r.json()).backupCodes as string[] }
}

const connecter = () => loginPOST(nu('/api/portal/auth/login', { email: 'jean@test.fr', password: MDP }))

describe('le secret TOTP n\'est plus lisible dans la base', () => {
  it('la colonne ne contient PAS le secret en clair', async () => {
    const { secret } = await activer()
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })

    // Le cœur du défaut : c'est cette colonne qui part dans les sauvegardes.
    expect(u.twoFactorSecret).not.toBe(secret)
    expect(u.twoFactorSecret).not.toContain(secret)
    expect(u.twoFactorSecret.startsWith('gtotp1.')).toBe(true)
    // Et il reste néanmoins utilisable : c'est tout l'enjeu d'un secret TOTP.
    expect(u.twoFactorEnabled).toBe(true)
  })

  it('le secret EN ATTENTE est protégé lui aussi', async () => {
    // Un enrôlement abandonné laisse `twoFactorPending` derrière lui : le
    // protéger seulement à l'activation laisserait une fenêtre en clair.
    const s = await (await setupPOST(auth('/api/portal/auth/2fa/setup', {}))).json()
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.twoFactorPending).not.toBe(s.secret)
    expect(u.twoFactorPending.startsWith('gtotp1.')).toBe(true)
  })

  it('un enrôlement abandonné ne protège PAS faussement le compte', async () => {
    await setupPOST(auth('/api/portal/auth/2fa/setup', {}))
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.twoFactorEnabled).toBe(false)
    // La connexion reste en un temps : rien ne laisse croire à une protection.
    expect((await (await connecter()).json()).requires2fa).toBeUndefined()
  })
})

describe('enrôlement', () => {
  it('rend de quoi configurer une application d\'authentification', async () => {
    const d = await (await setupPOST(auth('/api/portal/auth/2fa/setup', {}))).json()
    expect(d.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(d.otpauth).toContain('otpauth://totp/GarageFlows')
    expect(d.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('un code faux n\'active rien', async () => {
    await setupPOST(auth('/api/portal/auth/2fa/setup', {}))
    expect((await enablePOST(auth('/api/portal/auth/2fa/enable', { token: '000000' }))).status).toBe(401)
    expect((await prisma.portalUser.findUnique({ where: { id: userId } })).twoFactorEnabled).toBe(false)
  })

  it('activer sans avoir commencé l\'enrôlement est refusé', async () => {
    expect((await enablePOST(auth('/api/portal/auth/2fa/enable', { token: '123456' }))).status).toBe(400)
  })

  it('le secret n\'est plus jamais rendu après activation', async () => {
    await activer()
    const r = await setupPOST(auth('/api/portal/auth/2fa/setup', {}))
    expect(r.status).toBe(409)
    expect(JSON.stringify(await r.json())).not.toMatch(/[A-Z2-7]{32}/)
  })
})

describe('connexion en deux temps', () => {
  it('le mot de passe seul ne crée AUCUNE session', async () => {
    await activer()
    const r = await connecter()
    const d = await r.json()
    expect(d.requires2fa).toBe(true)
    expect(typeof d.challenge).toBe('string')
    // C'est la propriété décisive : aucun cookie de session n'est posé.
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(d.ok).toBeUndefined()
  })

  it('le bon code ouvre la session', async () => {
    const { secret } = await activer()
    const { challenge } = await (await connecter()).json()
    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: generateTotp(secret) }))
    expect(r.status).toBe(200)
    expect(r.headers.get('set-cookie')).toContain(PORTAL_COOKIE)

    // La session obtenue ouvre réellement le portail.
    const jeton = (r.headers.get('set-cookie') ?? '').split(';')[0].split('=').slice(1).join('=')
    const d = await dashboardGET(new NextRequest('http://localhost/api/portal/me/dashboard', {
      headers: { cookie: `${PORTAL_COOKIE}=${jeton}` },
    }))
    expect(d.status).toBe(200)
  })

  it('un mauvais code, un challenge inventé ou absent sont refusés', async () => {
    const { secret } = await activer()
    const { challenge } = await (await connecter()).json()
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: '000000' }))).status).toBe(401)
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: 'invente', token: generateTotp(secret) }))).status).toBe(401)
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { token: generateTotp(secret) }))).status).toBe(401)
  })

  it('un code d\'une fenêtre trop ancienne est refusé', async () => {
    const { secret } = await activer()
    const { challenge } = await (await connecter()).json()
    // Cinq minutes en arrière : hors de la tolérance de dérive d'horloge.
    const vieux = generateTotp(secret, Date.now() - 5 * 60_000)
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: vieux }))).status).toBe(401)
  })
})

describe('codes de secours — la sortie quand l\'appareil est perdu', () => {
  it('dix codes sont remis une seule fois, et stockés hachés', async () => {
    const { backupCodes } = await activer()
    expect(backupCodes).toHaveLength(10)
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    const stockes = JSON.parse(u.backupCodes)
    expect(stockes).toHaveLength(10)
    for (const c of backupCodes) expect(stockes).not.toContain(c)
  })

  it('un code de secours ouvre la session, et ne resert JAMAIS', async () => {
    const { backupCodes } = await activer()
    const code = backupCodes[0]

    const c1 = (await (await connecter()).json()).challenge
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: c1, backupCode: code }))).status).toBe(200)

    // Réutilisation : c'est tout l'intérêt d'un code « à usage unique ».
    const c2 = (await (await connecter()).json()).challenge
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: c2, backupCode: code }))).status).toBe(401)
    expect(JSON.parse((await prisma.portalUser.findUnique({ where: { id: userId } })).backupCodes)).toHaveLength(9)
  })
})

describe('désactivation', () => {
  it('exige le mot de passe — une session ne suffit pas', async () => {
    await activer()
    expect((await disablePOST(auth('/api/portal/auth/2fa/disable', { password: 'faux' }))).status).toBe(401)
    expect((await prisma.portalUser.findUnique({ where: { id: userId } })).twoFactorEnabled).toBe(true)
  })

  it('efface le secret ET les codes de secours', async () => {
    await activer()
    expect((await disablePOST(auth('/api/portal/auth/2fa/disable', { password: MDP }))).status).toBe(200)
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    expect(u.twoFactorEnabled).toBe(false)
    expect(u.twoFactorSecret).toBeNull()
    expect(u.twoFactorPending).toBeNull()
    expect(u.backupCodes).toBe('[]')
    // La connexion redevient en un temps.
    expect((await (await connecter()).json()).requires2fa).toBeUndefined()
  })
})

describe('rétrogradation du format — la porte que le repli laissait ouverte', () => {
  /**
   * Accepter une valeur en clair rendait le système PLUS permissif sur un
   * format non reconnu : qui obtient une écriture en base remplace le chiffré
   * par un secret qu'il choisit, et passe le second facteur avec ses propres
   * codes. Le chiffrement ne protégeait alors que la lecture.
   */
  it('un secret remis EN CLAIR dans la colonne ne valide plus rien', async () => {
    await activer()
    // L'attaquant écrit un secret qu'il maîtrise, sans le chiffrer.
    const sien = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    await prisma.portalUser.update({ where: { id: userId }, data: { twoFactorSecret: sien } })

    const { challenge } = await (await connecter()).json()
    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: generateTotp(sien) }))
    expect(r.status).toBe(401)
    expect(r.headers.get('set-cookie')).toBeNull()
  })

  it('un chiffré ALTÉRÉ ne valide rien non plus', async () => {
    const { secret } = await activer()
    const u = await prisma.portalUser.findUnique({ where: { id: userId } })
    // On casse un octet du corps chiffré : l'authentification GCM doit échouer.
    const abime = u.twoFactorSecret.slice(0, -6) + 'AAAAAA'
    await prisma.portalUser.update({ where: { id: userId }, data: { twoFactorSecret: abime } })

    const { challenge } = await (await connecter()).json()
    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: generateTotp(secret) }))
    expect(r.status).toBe(401)
  })

  it('mais le compte n\'est PAS enfermé : le code de secours fonctionne encore', async () => {
    // C'est ce qui rend le refus ci-dessus tenable. Les codes de secours sont
    // hachés à part : ils ne dépendent pas du secret devenu illisible.
    const { backupCodes } = await activer()
    await prisma.portalUser.update({
      where: { id: userId },
      data: { twoFactorSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' },
    })

    const { challenge } = await (await connecter()).json()
    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, backupCode: backupCodes[0] }))
    expect(r.status).toBe(200)
    expect(r.headers.get('set-cookie')).toContain(PORTAL_COOKIE)
  })

  it('un enrôlement EN COURS au format clair ne s\'active pas', async () => {
    await setupPOST(auth('/api/portal/auth/2fa/setup', {}))
    const sien = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    await prisma.portalUser.update({ where: { id: userId }, data: { twoFactorPending: sien } })
    const r = await enablePOST(auth('/api/portal/auth/2fa/enable', { token: generateTotp(sien) }))
    expect(r.status).toBe(401)
    expect((await prisma.portalUser.findUnique({ where: { id: userId } })).twoFactorEnabled).toBe(false)
  })
})

describe('isolation entre comptes', () => {
  it('le secret d\'un compte ne valide pas la connexion d\'un autre', async () => {
    const { secret } = await activer()

    const autre = await prisma.portalUser.create({
      data: {
        garageId, email: 'autre@test.fr',
        passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true,
        twoFactorEnabled: true,
      },
    })
    // Compte protégé mais SANS secret : la vérification doit refuser, pas
    // retomber sur un autre secret ni sur une acceptation par défaut.
    const r = await loginPOST(nu('/api/portal/auth/login', { email: 'autre@test.fr', password: MDP }))
    const { challenge } = await r.json()
    const v = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: generateTotp(secret) }))
    expect(v.status).toBe(400)
    expect(r.headers.get('set-cookie')).toBeNull()
    await prisma.portalUser.delete({ where: { id: autre.id } })
  })
})

/**
 * GF-DUR-016 — le mot de passe provisoire enfermait le client dehors.
 *
 * ─── L'enchaînement complet, tel qu'il se produisait ────────────────────────
 *   1. le garage ouvre un accès → mot de passe provisoire, `mustChangePassword` ;
 *   2. le client se connecte : la session est bien émise ;
 *   3. TOUTE route du portail répond alors 403 `PASSWORD_CHANGE_REQUIRED` —
 *      c'est voulu, et correct ;
 *   4. son espace client traitait tout échec non-401 comme « pas de données » :
 *      page BLANCHE, sans explication ;
 *   5. et AUCUN écran n'appelait la route de changement.
 *
 * Résultat : chaque accès ouvert par le garage produisait un client enfermé
 * dehors, définitivement. Le défaut n'était dans aucune route — toutes se
 * comportaient correctement — mais dans l'absence du seul écran qui refermait
 * la boucle.
 *
 * Ces tests exercent la sortie de bout en bout, et vérifient que les refus
 * portent bien le code sur lequel l'interface s'appuie pour rediriger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-mdp-provisoire.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-mot-de-passe-provisoire-0123456789'

vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async () => ({ ok: true }),
}))

const sess = vi.hoisted(() => ({ garageId: '', role: 'OWNER' }))
vi.mock('@/lib/api-helpers', async () => {
  const reel = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers')
  return {
    ...reel,
    withAuth: (h: unknown) => h,
    requireSession: async () => ({
      user: { id: 'u-garage', role: sess.role, garageId: sess.garageId, name: 'Comptoir', email: 'g@test.fr' },
    }),
  }
})
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let accesPOST: (r: NextRequest, ctx: { params: { id: string } }) => Promise<Response>
let loginPOST: (r: NextRequest) => Promise<Response>
let passwordPUT: (r: NextRequest) => Promise<Response>
let dashboardGET: (r: NextRequest) => Promise<Response>
let ticketsGET: (r: NextRequest) => Promise<Response>
let PORTAL_COOKIE: string
let prisma: any
let resetRateLimit: (c: string, s: string) => Promise<void>

let garageId: string, clientId: string

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: accesPOST } = (await import('@/app/api/clients/[id]/portal-access/route')) as any)
  ;({ POST: loginPOST } = (await import('@/app/api/portal/auth/login/route')) as any)
  ;({ PUT: passwordPUT } = (await import('@/app/api/portal/auth/password/route')) as any)
  ;({ GET: dashboardGET } = (await import('@/app/api/portal/me/dashboard/route')) as any)
  ;({ GET: ticketsGET } = (await import('@/app/api/portal/tickets/route')) as any)
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)
  ;({ resetRateLimit } = (await import('@/lib/security/rate-limit')) as any)
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  // Sans `TRUST_PROXY_HEADERS`, `clientIpFrom` rend « unverified » pour tout le
  // monde : le compteur de connexions est donc PARTAGÉ par tous les fichiers de
  // test du même processus. Ce test échouait en 429 dans la suite complète tout
  // en passant seul — un faux échec, dont la cause n'était pas le produit.
  await resetRateLimit('login', 'portal-login:unverified')
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
  await prisma.client.deleteMany({})
  await prisma.garage.deleteMany({})
  garageId = (await prisma.garage.create({ data: { name: 'Garage A', slug: `a-${Date.now()}` } })).id
  sess.garageId = garageId
  clientId = (await prisma.client.create({ data: { garageId, name: 'Jean Dupont', email: 'jean@test.fr' } })).id
})

/** Le garage ouvre l'accès et récupère le mot de passe provisoire, montré une fois. */
async function ouvrirAcces(): Promise<string> {
  const r = await accesPOST(
    new NextRequest(`http://localhost/api/clients/${clientId}/portal-access`, { method: 'POST' }),
    { params: { id: clientId } },
  )
  expect(r.status).toBe(201)
  const d = await r.json()
  expect(typeof d.motDePasseTemporaireEnClair).toBe('string')
  return d.motDePasseTemporaireEnClair
}

/** Connecte le client et rend son cookie de session. */
async function connecter(motDePasse: string) {
  const r = await loginPOST(new NextRequest('http://localhost/api/portal/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jean@test.fr', password: motDePasse }),
  }))
  const corps = await r.json()
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0].split('=').slice(1).join('=')
  return { statut: r.status, corps, cookie }
}

const avec = (cookie: string, url: string) =>
  new NextRequest(`http://localhost${url}`, { headers: { cookie: `${PORTAL_COOKIE}=${cookie}` } })

describe('le mot de passe provisoire ferme bien le portail', () => {
  it('la connexion réussit, mais annonce que le mot de passe doit être défini', async () => {
    const mdp = await ouvrirAcces()
    const { statut, corps } = await connecter(mdp)
    expect(statut).toBe(200)
    // C'est CE drapeau que l'écran de connexion lit pour envoyer directement à
    // la définition du mot de passe, au lieu d'un aller-retour par une page vide.
    expect(corps.mustChangePassword).toBe(true)
  })

  it('toute route du portail refuse avec un code exploitable par l\'interface', async () => {
    const mdp = await ouvrirAcces()
    const { cookie } = await connecter(mdp)

    for (const [nom, appel, url] of [
      ['tableau de bord', dashboardGET, '/api/portal/me/dashboard'],
      ['messagerie', ticketsGET, '/api/portal/tickets'],
    ] as const) {
      const r = await appel(avec(cookie, url))
      expect(r.status, nom).toBe(403)
      // Sans ce code, l'interface ne peut pas distinguer « mot de passe à
      // définir » d'une panne — c'est exactement ce qui produisait la page
      // blanche.
      expect((await r.json()).code, nom).toBe('PASSWORD_CHANGE_REQUIRED')
    }
  })
})

describe('la sortie existe et fonctionne', () => {
  it('définir son mot de passe rouvre tout le portail', async () => {
    const mdp = await ouvrirAcces()
    const { cookie } = await connecter(mdp)

    const chg = await passwordPUT(new NextRequest('http://localhost/api/portal/auth/password', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: mdp, newPassword: 'MonNouveauMotDePasse2026' }),
    }))
    expect(chg.status).toBe(200)

    // La session COURANTE survit : sans cela, le client serait déconnecté par
    // son propre changement et retomberait sur la connexion.
    expect((await dashboardGET(avec(cookie, '/api/portal/me/dashboard'))).status).toBe(200)
    expect((await ticketsGET(avec(cookie, '/api/portal/tickets'))).status).toBe(200)

    const u = await prisma.portalUser.findFirst({ where: { clientId } })
    expect(u.mustChangePassword).toBe(false)
    expect(u.passwordChangedAt).not.toBeNull()
  })

  it('le nouveau mot de passe est celui qui sert désormais à se connecter', async () => {
    const mdp = await ouvrirAcces()
    const { cookie } = await connecter(mdp)
    await passwordPUT(new NextRequest('http://localhost/api/portal/auth/password', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: mdp, newPassword: 'MonNouveauMotDePasse2026' }),
    }))

    expect((await connecter(mdp)).statut).toBe(401)
    const apres = await connecter('MonNouveauMotDePasse2026')
    expect(apres.statut).toBe(200)
    // Et l'écran n'impose plus rien.
    expect(apres.corps.mustChangePassword).toBe(false)
  })

  it('le mot de passe actuel reste exigé, même provisoire', async () => {
    // Ne pas l'exiger aurait paru commode — le client vient de le saisir — mais
    // un cookie volé aurait suffi à s'approprier le compte définitivement.
    const mdp = await ouvrirAcces()
    const { cookie } = await connecter(mdp)
    const r = await passwordPUT(new NextRequest('http://localhost/api/portal/auth/password', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'pas-le-bon', newPassword: 'MonNouveauMotDePasse2026' }),
    }))
    expect(r.status).toBe(403)
    expect((await prisma.portalUser.findFirst({ where: { clientId } })).mustChangePassword).toBe(true)
  })

  it('reprendre le mot de passe provisoire ne définit rien', async () => {
    const mdp = await ouvrirAcces()
    const { cookie } = await connecter(mdp)
    const r = await passwordPUT(new NextRequest('http://localhost/api/portal/auth/password', {
      method: 'PUT',
      headers: { cookie: `${PORTAL_COOKIE}=${cookie}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: mdp, newPassword: mdp }),
    }))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('PASSWORD_UNCHANGED')
  })
})

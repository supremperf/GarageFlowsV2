/**
 * GF-DUR-024 — 2FA : ciblage d'autrui, concurrence, et diagnostic de clé.
 *
 * ─── Ce qu'on refuse de supposer ────────────────────────────────────────────
 * « Les routes prennent l'utilisateur dans la session, donc l'IDOR est
 * impossible » est une affirmation d'architecture, pas une preuve. Elle cesse
 * d'être vraie le jour où quelqu'un ajoute un paramètre `userId` « pour
 * l'administration ». Ces tests exercent donc réellement la tentative, ET
 * verrouillent la propriété structurelle qui la rend vaine.
 *
 * De même : « un code de secours retiré après usage ne peut servir qu'une fois »
 * suppose que deux requêtes simultanées ne peuvent pas le lire ensemble. C'est
 * précisément ce qu'il faut éprouver, pas admettre.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-2fa-idor.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-idor-2fa-0123456789abcdefghij'
process.env.GF_TOTP_ENC_KEY = Buffer.alloc(32, 55).toString('base64')

const RACINE = path.resolve(__dirname, '../..')

let setupPOST: (r: NextRequest) => Promise<Response>
let enablePOST: (r: NextRequest) => Promise<Response>
let disablePOST: (r: NextRequest) => Promise<Response>
let verifyPOST: (r: NextRequest) => Promise<Response>
let loginPOST: (r: NextRequest) => Promise<Response>
let signPortalSession: (c: { sub: string; sid: string; gid: string }) => Promise<string>
let PORTAL_COOKIE: string
let generateTotp: (s: string) => string
let resetRateLimit: (c: string, s: string) => Promise<void>
let diagnostiquerSecretsTotp: (db: unknown) => Promise<{ enroles: number; illisibles: number }>
let prisma: any

const MDP = 'MotDePasseClient2026'

interface ClientProtege {
  gid: string; uid: string; slug: string; email: string
  cookie: string; secret: string; codes: string[]
}
/** Deux garages, un client protégé dans chacun. */
let A: ClientProtege
let B: ClientProtege

/**
 * Connexion d'un client — `garageSlug` est OBLIGATOIRE ici.
 *
 * Avec deux garages en base, le serveur refuse de deviner lequel (400
 * « ambigu »). Une première version de ce fichier l'omettait : les connexions
 * échouaient, le challenge valait `undefined`, et les assertions « la
 * vérification échoue » passaient pour cette raison-là — pas pour celle qu'elles
 * annonçaient. Un faux PASS exemplaire.
 */
async function connecter(c: ClientProtege): Promise<{ challenge: string }> {
  const r = await loginPOST(nu('/api/portal/auth/login', { email: c.email, password: MDP, garageSlug: c.slug }))
  const corps = await r.json()
  // Le challenge est le POINT DE DÉPART de tout ce fichier : si la connexion
  // échoue, les « 401 » qui suivent ne prouveraient rien. On le dit ici, avec la
  // réponse réelle, plutôt que de laisser un `undefined` se propager.
  expect(r.status, `connexion refusée : ${JSON.stringify(corps)}`).toBe(200)
  expect(corps.requires2fa, 'le second facteur devrait être exigé').toBe(true)
  return corps
}

const avec = (cookie: string, url: string, corps: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `${PORTAL_COOKIE}=${cookie}` },
    body: JSON.stringify(corps),
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
  signPortalSession = (await import('@/lib/portal/session')).signPortalSession as never
  ;({ PORTAL_COOKIE } = (await import('@/lib/portal/auth-helpers')) as any)
  ;({ generateTotp } = (await import('@/lib/portal/totp')) as any)
  ;({ resetRateLimit } = (await import('@/lib/security/rate-limit')) as any)
  ;({ diagnostiquerSecretsTotp } = (await import('@/lib/portal/totp-storage')) as any)
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

/** Crée un garage, un client protégé par 2FA, et rend de quoi agir en son nom. */
async function garageProtege(marque: string): Promise<ClientProtege> {
  const slug = `g-${marque.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`
  const gid = (await prisma.garage.create({ data: { name: `Garage ${marque}`, slug } })).id
  // Minuscules OBLIGATOIRES : la connexion normalise l'adresse reçue
  // (`.toLowerCase()`), et la recherche `garageId_email` est sensible à la casse.
  // Les quatre chemins d'écriture du produit normalisent eux aussi — c'est
  // vérifié — mais une fixture en casse mixte, elle, fabriquerait un compte
  // introuvable et ferait échouer la connexion pour une raison sans rapport.
  const email = `client-${marque.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@test.fr`
  const uid = (await prisma.portalUser.create({
    data: { garageId: gid, email, passwordHash: await bcrypt.hash(MDP, 10), emailVerified: true },
  })).id
  const sid = `s-${Math.random().toString(36).slice(2)}`
  await prisma.portalDevice.create({ data: { portalUserId: uid, sessionId: sid } })
  const cookie = await signPortalSession({ sub: uid, sid, gid })

  const s = await (await setupPOST(avec(cookie, '/api/portal/auth/2fa/setup', {}))).json()
  const r = await enablePOST(avec(cookie, '/api/portal/auth/2fa/enable', { token: generateTotp(s.secret) }))
  expect(r.status).toBe(200)
  return { gid, uid, slug, email, cookie, secret: s.secret as string, codes: (await r.json()).backupCodes as string[] }
}

beforeEach(async () => {
  await resetRateLimit('login', 'portal-login:unverified')
  await resetRateLimit('login', 'portal-2fa:unverified')
  await prisma.portalDevice.deleteMany({})
  await prisma.portalUser.deleteMany({})
  await prisma.garage.deleteMany({})
  A = await garageProtege('A')
  B = await garageProtege('B')
})

/** État 2FA d'un compte, lu directement en base. */
const etat2fa = (uid: string) =>
  prisma.portalUser.findUnique({
    where: { id: uid },
    select: { twoFactorEnabled: true, twoFactorSecret: true, twoFactorPending: true, backupCodes: true },
  })

describe('A ne peut pas atteindre le 2FA de B', () => {
  /**
   * Les tentatives portent un `userId`, un `email`, un `portalUserId` : tout ce
   * qu'un attaquant essaierait. Aucune n'est censée être lue — c'est justement
   * ce que le test doit établir plutôt que de le tenir pour acquis.
   */
  const CIBLAGES = (uid: string, email = 'client-b@test.fr') => [
    { userId: uid }, { portalUserId: uid }, { id: uid }, { sub: uid }, { email },
  ]

  it('setup : A ne déclenche pas d\'enrôlement pour B', async () => {
    const avantB = await etat2fa(B.uid)
    for (const cible of CIBLAGES(B.uid)) {
      // A a déjà activé son 2FA : sa propre demande est refusée (409). Ce qui
      // compte est que B ne bouge pas, quel que soit le paramètre ajouté.
      await setupPOST(avec(A.cookie, '/api/portal/auth/2fa/setup', cible))
      expect(await etat2fa(B.uid)).toEqual(avantB)
    }
  })

  it('enable : aucun code, ni de A ni de B, n\'active quoi que ce soit chez B', async () => {
    await disablePOST(avec(B.cookie, '/api/portal/auth/2fa/disable', { password: MDP }))
    await setupPOST(avec(B.cookie, '/api/portal/auth/2fa/setup', {}))
    const avantB = await etat2fa(B.uid)

    for (const jeton of [generateTotp(A.secret), generateTotp(B.secret), '000000']) {
      for (const cible of CIBLAGES(B.uid)) {
        await enablePOST(avec(A.cookie, '/api/portal/auth/2fa/enable', { token: jeton, ...cible }))
      }
    }
    // B reste EXACTEMENT dans l'état où on l'a laissé : ni activé, ni secret changé.
    expect(await etat2fa(B.uid)).toEqual(avantB)
    expect((await etat2fa(B.uid)).twoFactorEnabled).toBe(false)
  })

  it('disable : A ne désactive pas le 2FA de B, même avec SON propre mot de passe', async () => {
    const avantB = await etat2fa(B.uid)
    for (const cible of CIBLAGES(B.uid)) {
      await disablePOST(avec(A.cookie, '/api/portal/auth/2fa/disable', { password: MDP, ...cible }))
    }
    const apresB = await etat2fa(B.uid)
    expect(apresB.twoFactorEnabled).toBe(true)
    expect(apresB.twoFactorSecret).toBe(avantB.twoFactorSecret)
    expect(apresB.backupCodes).toBe(avantB.backupCodes)
  })

  it('recovery : un code de secours de B ne sert pas à A, et reste intact', async () => {
    const avantB = await etat2fa(B.uid)
    // A se connecte : son challenge lui est propre. Y présenter un code de B ne
    // doit ni l'authentifier, ni consommer le code de B.
    const { challenge } = await connecter(A)

    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, backupCode: B.codes[0] }))
    expect(r.status).toBe(401)
    expect(r.headers.get('set-cookie')).toBeNull()
    expect((await etat2fa(B.uid)).backupCodes).toBe(avantB.backupCodes)
  })

  it('le secret de A ne valide pas le challenge de B', async () => {
    const { challenge } = await connecter(B)
    expect(typeof challenge).toBe('string')
    const r = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge, token: generateTotp(A.secret) }))
    expect(r.status).toBe(401)
    // Contrôle POSITIF : le bon secret, lui, ouvre — sinon ce test passerait
    // même si la vérification refusait tout.
    const { challenge: c2 } = await connecter(B)
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: c2, token: generateTotp(B.secret) }))).status).toBe(200)
  })
})

describe('l\'identité ne vient JAMAIS de la requête', () => {
  /**
   * La raison structurelle pour laquelle les tentatives ci-dessus échouent :
   * les routes 2FA ne lisent aucun identifiant d'utilisateur dans le corps, la
   * requête ou les paramètres. Le jour où quelqu'un en ajoute un « pour
   * l'administration », ce test tombe — et c'est tout son intérêt.
   */
  const ROUTES = [
    'src/app/api/portal/auth/2fa/setup/route.ts',
    'src/app/api/portal/auth/2fa/enable/route.ts',
    'src/app/api/portal/auth/2fa/disable/route.ts',
  ]

  it('aucune route 2FA ne lit d\'identifiant d\'utilisateur fourni par le client', () => {
    for (const rel of ROUTES) {
      const src = fs.readFileSync(path.join(RACINE, rel), 'utf8')
      // Le seul `user` autorisé est celui que `withPortalAuth` injecte.
      expect(src, `${rel} : identité déduite de la session`).toMatch(/withPortalAuth\(/)
      for (const motif of [
        /body\.userId/, /body\.portalUserId/, /body\.email/, /body\.id\b/,
        /searchParams\.get\(['"]userId/, /params\.(userId|id)\b/,
      ]) {
        expect(src, `${rel} : lit ${motif} dans la requête`).not.toMatch(motif)
      }
    }
  })

  it('la vérification du second facteur part du challenge SIGNÉ, pas d\'un identifiant', () => {
    const src = fs.readFileSync(path.join(RACINE, 'src/app/api/portal/auth/2fa/verify/route.ts'), 'utf8')
    expect(src).toMatch(/verifyTwoFactorChallenge\(/)
    expect(src).not.toMatch(/body\.userId|body\.email/)
  })
})

describe('concurrence sur un code de secours', () => {
  it('deux requêtes simultanées avec le MÊME code : une seule ouvre une session', async () => {
    // « Retiré après usage, donc utilisable une seule fois » suppose que deux
    // requêtes ne peuvent pas le lire ensemble. C'est ce qu'on éprouve.
    const code = A.codes[0]
    const c1 = (await connecter(A)).challenge
    const c2 = (await connecter(A)).challenge
    expect(typeof c1).toBe('string')
    expect(typeof c2).toBe('string')

    const [r1, r2] = await Promise.all([
      verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: c1, backupCode: code })),
      verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: c2, backupCode: code })),
    ])

    const reussites = [r1, r2].filter((r) => r.status === 200)
    expect(reussites.length, 'un code de secours consommé deux fois').toBe(1)
    // Et il n'en reste que neuf : un seul a été retiré.
    expect(JSON.parse((await etat2fa(A.uid)).backupCodes)).toHaveLength(9)
  })

  it('deux codes DIFFÉRENTS simultanés : les deux ouvrent, et aucun ne ressuscite', async () => {
    // La face la plus grave du même défaut. Avec un lire-modifier-écrire, R1
    // écrit « sans c1 » et R2 « sans c2 » à partir du même état lu : la dernière
    // écriture gagne et REMET c1 (ou c2) dans la liste. Un code que son porteur
    // croit périmé redevient un identifiant valide, sans trace.
    //
    // CE QUE CE TEST PROUVE, ET CE QU'IL NE PROUVE PAS : `Promise.all` ne
    // GARANTIT pas le chevauchement. Mesuré sous mutation, cet entrelacement-ci
    // se sérialisait et le test passait sans la protection — il ne peut donc pas
    // servir de détecteur de course. Il vaut comme preuve de bout en bout (vraies
    // routes, vraie base, vraies sessions) que deux codes distincts aboutissent
    // et qu'aucun ne réapparaît. L'entrelacement, lui, est imposé et vérifié
    // dans src/lib/portal/__tests__/backup-codes-store.test.ts.
    const [c1, c2] = [A.codes[0], A.codes[1]]
    const ch1 = (await connecter(A)).challenge
    const ch2 = (await connecter(A)).challenge

    const [r1, r2] = await Promise.all([
      verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: ch1, backupCode: c1 })),
      verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: ch2, backupCode: c2 })),
    ])
    // Deux codes distincts sont un usage LÉGITIME : les deux doivent aboutir.
    expect([r1.status, r2.status], 'deux codes distincts doivent tous deux ouvrir').toEqual([200, 200])

    const restants = JSON.parse((await etat2fa(A.uid)).backupCodes) as string[]
    expect(restants).toHaveLength(8)
    // Preuve directe qu'aucun n'est revenu : ni c1 ni c2 ne se revérifie.
    for (const consomme of [c1, c2]) {
      const ch = (await connecter(A)).challenge
      const rejeu = await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: ch, backupCode: consomme }))
      expect(rejeu.status, 'un code déjà consommé est redevenu valide').toBe(401)
    }
    // Un code JAMAIS utilisé, lui, fonctionne toujours : le test ci-dessus ne
    // passe pas simplement parce que tout serait devenu refusé.
    const ch = (await connecter(A)).challenge
    expect((await verifyPOST(nu('/api/portal/auth/2fa/verify', { challenge: ch, backupCode: A.codes[2] }))).status).toBe(200)
  })
})

describe('diagnostic de lisibilité des secrets', () => {
  it('compte les comptes enrôlés et ceux devenus illisibles', async () => {
    expect(await diagnostiquerSecretsTotp(prisma)).toEqual({ enroles: 2, illisibles: 0 })

    // Simule l'accident de rotation : la valeur n'est plus déchiffrable.
    await prisma.portalUser.update({
      where: { id: B.uid }, data: { twoFactorSecret: 'gtotp1.dead.AAAA.BBBB.CCCC' },
    })
    expect(await diagnostiquerSecretsTotp(prisma)).toEqual({ enroles: 2, illisibles: 1 })
  })

  it('ne compte pas les comptes NON enrôlés', async () => {
    await disablePOST(avec(B.cookie, '/api/portal/auth/2fa/disable', { password: MDP }))
    expect(await diagnostiquerSecretsTotp(prisma)).toEqual({ enroles: 1, illisibles: 0 })
  })
})

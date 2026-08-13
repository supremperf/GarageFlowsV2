/**
 * GF31-AUD-057 à 063 — le reste des P3 : divulgation, énumération, écrans qui
 * mentent, et deux gardes qui ne couvraient pas tout leur chemin.
 *
 * · 059 — `GET /api/garages` servait l'annuaire du personnel (noms, e-mails,
 *   rôles) à TOUT rôle authentifié, alors que `GET /api/users` le réserve à
 *   OWNER/MANAGER : le contrôle posé sur une porte se contournait par celle
 *   d'à côté.
 * · 060 — l'inscription au portail confirmait l'existence d'un compte pour une
 *   adresse donnée, annulant l'anti-énumération de la connexion.
 * · 061 / 062 — le tableau de bord client perdait le garage à la redirection, et
 *   affirmait « Aucune facture » à un client dont le compte n'était simplement
 *   pas encore rattaché.
 * · 057 / 063 — redirections de téléchargement non revalidées, et onglet
 *   e-facturation proposé à un rôle qui n'y trouve que des 403.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-portal-rbac-p3.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})
const mail = vi.hoisted(() => ({ envois: [] as Array<{ to: string; subject: string }> }))
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: { to: string; subject: string }) => {
    mail.envois.push({ to: m.to, subject: m.subject })
    return { ok: true }
  },
}))
vi.mock('@/lib/security/rate-limit', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, enforceRateLimit: async () => ({ ok: true, remaining: 99 }) }
})

const RACINE = path.resolve(__dirname, '../..')
let prisma: any
let garagesGET: (req: Request) => Promise<Response>
let registerPOST: (req: Request) => Promise<Response>
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: garagesGET } = (await import('@/app/api/garages/route')) as any)
  ;({ POST: registerPOST } = (await import('@/app/api/portal/auth/register/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'RBAC', slug: 'aud-p3-rbac' } })).id
  await prisma.user.create({
    data: { garageId, name: 'Patron', email: 'patron@example.fr', password: 'x', role: 'OWNER' },
  })
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  mail.envois = []
  await prisma.portalUser.deleteMany({ where: { garageId } })
})

const lireGarage = async (role: string | undefined) => {
  const precedent = h.session
  h.session = { user: { id: 'u2', role, garageId } }
  try {
    return await (await garagesGET(new Request('http://localhost/api/garages'))).json()
  } finally {
    h.session = precedent
  }
}

const inscrire = (email: string) =>
  registerPOST(new Request('http://localhost/api/portal/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse123', name: 'Client', garageSlug: 'aud-p3-rbac' }),
  }))

describe('GF31-AUD-059 — l’annuaire du personnel suit la même règle partout', () => {
  it.each(['RECEPTIONIST', 'MECHANIC', undefined])('%s : ne reçoit PAS la liste des comptes', async (role) => {
    const g = await lireGarage(role)
    expect(g.users).toBeUndefined()
    // …mais garde bien accès aux informations du garage lui-même.
    expect(g.name).toBe('RBAC')
    expect(g._count).toBeDefined()
  })

  it.each(['OWNER', 'MANAGER'])('%s : conserve l’annuaire', async (role) => {
    const g = await lireGarage(role)
    expect(Array.isArray(g.users)).toBe(true)
    expect(g.users[0].email).toBe('patron@example.fr')
  })

  it('le mot de passe SMTP n’est jamais exposé, quel que soit le rôle', async () => {
    for (const role of ['OWNER', 'RECEPTIONIST']) {
      expect(JSON.stringify(await lireGarage(role))).not.toContain('smtpPass')
    }
  })
})

describe('GF31-AUD-060 — l’inscription ne révèle plus l’existence d’un compte', () => {
  it('deux inscriptions sur la même adresse rendent la MÊME réponse', async () => {
    const a = await inscrire('client@example.fr')
    expect(a.status).toBe(201)
    const corpsA = await a.json()

    const b = await inscrire('client@example.fr')
    expect(b.status).toBe(201)
    const corpsB = await b.json()

    expect(corpsB.ok).toBe(corpsA.ok)
    expect(corpsB.requiresEmailVerification).toBe(corpsA.requiresEmailVerification)
    // Aucun message ne distingue les deux cas.
    expect(JSON.stringify(corpsB)).not.toMatch(/existe déjà/i)
  })

  it('aucun second compte n’est créé, et le titulaire légitime est prévenu', async () => {
    await inscrire('client@example.fr')
    mail.envois = []
    await inscrire('client@example.fr')

    expect(await prisma.portalUser.count({ where: { garageId, email: 'client@example.fr' } })).toBe(1)
    expect(mail.envois).toHaveLength(1)
    expect(mail.envois[0].to).toBe('client@example.fr')
    expect(mail.envois[0].subject).toMatch(/tentative/i)
  })

  it('le mot de passe existant n’est jamais réécrit par une seconde tentative', async () => {
    await inscrire('client@example.fr')
    const avant = (await prisma.portalUser.findFirst({ where: { garageId, email: 'client@example.fr' } })).passwordHash
    await inscrire('client@example.fr')
    const apres = (await prisma.portalUser.findFirst({ where: { garageId, email: 'client@example.fr' } })).passwordHash
    expect(apres).toBe(avant)
  })
})

describe('GF31-AUD-061 / 062 — le tableau de bord client dit ce qui se passe', () => {
  const page = () => readFileSync(path.join(RACINE, 'src/app/portal/account/page.tsx'), 'utf8')

  it('les redirections conservent le garage', () => {
    const s = page()
    expect(s).toContain("lienPortail('/portal/login')")
    expect(s).not.toMatch(/router\.replace\('\/portal\/login'\)/)
  })

  it('un compte non rattaché est signalé, au lieu d’un « Aucune facture » trompeur', () => {
    const s = page()
    expect(s).toContain('!data.linkedClient')
    expect(s).toMatch(/pas encore reli/i)
  })
})

describe('GF31-AUD-057 — chaque redirection de téléchargement est revalidée', () => {
  it('la règle existe en un seul endroit et couvre protocole et domaine', async () => {
    const uv = await import('../../electron/update-verify.js')
    const check = (uv as unknown as { checkDownloadUrl: (u: string) => { ok: boolean } }).checkDownloadUrl
    expect(check('https://api.garageflows.fr/x.exe').ok).toBe(true)
    expect(check('http://api.garageflows.fr/x.exe').ok).toBe(false)   // clair → refusé
    expect(check('https://mechant.example/x.exe').ok).toBe(false)     // hors liste blanche
    expect(check('pas-une-url').ok).toBe(false)
    // Le serveur embarqué de l'application reste joignable (publication locale).
    expect(check('http://127.0.0.1:4173/api/admin/updates/file/x.exe').ok).toBe(true)
  })

  it('le téléchargeur l’applique à CHAQUE saut', () => {
    const main = readFileSync(path.join(RACINE, 'electron/main.js'), 'utf8')
    expect(main).toContain('updateVerify.checkDownloadUrl(u)')
    // …et résout les Location relatifs plutôt que de les suivre à l'aveugle.
    expect(main).toContain('new URL(res.headers.location, u)')
  })
})

describe('GF31-AUD-063 — l’onglet e-facturation n’est proposé qu’à qui peut s’en servir', () => {
  it('il suit `settings:manage`, pas la permission d’accès mécaniciens', () => {
    const s = readFileSync(path.join(RACINE, 'src/components/SettingsModal.tsx'), 'utf8')
    expect(s).toContain('canManageSettings')
    expect(s).toMatch(/canManageSettings \? \[\{ id: 'einvoicing'/)
    expect(s).not.toMatch(/canManageAccess \? \[\{ id: 'einvoicing'/)
  })

  it('la route, elle, exigeait déjà settings:manage — les deux concordent enfin', () => {
    const route = readFileSync(path.join(RACINE, 'src/app/api/einvoicing/connection/route.ts'), 'utf8')
    expect(route).toContain("can(session.user.role, 'settings:manage')")
  })
})

/**
 * « Ouvrir un accès » ne doit jamais faire dicter un mot de passe pour rien.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Sur un POSTE, la route créait un `PortalUser` dans le SQLite local, répondait
 * 201, et l'écran affichait « Accès prêt — communiquez le mot de passe
 * maintenant ». Le client recevait un lien vers `app.garageflows.fr`. Or le
 * portail interroge la base du CLOUD, aucune route ne répliquait ce compte, et
 * le serveur du poste n'écoute que sur 127.0.0.1. Le garagiste lisait donc à
 * voix haute un identifiant et un mot de passe pour un service qui ne les
 * connaîtrait jamais — sans aucun moyen de comprendre le refus.
 *
 * Ce qui est éprouvé ici : l'accès est PUBLIÉ, l'issue est dite, et rien n'est
 * annoncé au client tant qu'il ne peut pas s'en servir.
 *
 * Base RÉELLE (SQLite) ; seul le transport vers le cloud est simulé.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-portal-access.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({
  post: vi.fn(),
  licence: 'GF2.licence-garage' as string | null,
  garageId: '',
  mails: [] as Array<{ to: string; text: string }>,
}))

vi.mock('@/lib/sync/cloud-client', () => ({
  cloudPost: (...a: unknown[]) => h.post(...a),
  garageLicenseToken: async () => h.licence,
  isDesktopInstance: () => true,
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner-1', role: 'OWNER', garageId: h.garageId } }),
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: { to: string; text: string }) => { h.mails.push(m); return { ok: true } },
}))

let POST: any
let PUT: any
let PATCH: any
let prisma: any
let clientId = ''

const ouvrir = () => POST(new Request('http://localhost/x', { method: 'POST' }), { params: { id: clientId } })
const reinitialiser = () => PUT(new Request('http://localhost/x', { method: 'PUT' }), { params: { id: clientId } })
const basculer = (actif: boolean) => PATCH(new Request('http://localhost/x', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actif }),
}), { params: { id: clientId } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  const mod = (await import('@/app/api/clients/[id]/portal-access/route')) as any
  POST = mod.POST; PUT = mod.PUT; PATCH = mod.PATCH

  h.garageId = (await prisma.garage.create({ data: { name: 'Garage Dupont', slug: 'garage-dupont' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => {
  h.post.mockReset().mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
  h.licence = 'GF2.licence-garage'
  h.mails = []
  await prisma.portalUser.deleteMany({})
  await prisma.client.deleteMany({})
  clientId = (await prisma.client.create({
    data: { garageId: h.garageId, name: 'Client Test', email: 'client@example.test' },
  })).id
})

describe('l’accès est PUBLIÉ vers le service qui sert le portail', () => {
  it('ouvrir un accès le publie, avec le haché — jamais le mot de passe en clair', async () => {
    const r = await ouvrir()
    expect(r.status).toBe(201)
    const corps = await r.json()

    expect(h.post.mock.calls[0][0]).toBe('/api/sync/portal-account')
    const envoye = h.post.mock.calls[0][1]
    expect(envoye.account.email).toBe('client@example.test')
    expect(envoye.account.passwordHash, 'bcrypt, pas le mot de passe').toMatch(/^\$2[aby]\$/)
    expect(JSON.stringify(envoye), 'le mot de passe en clair ne doit JAMAIS transiter')
      .not.toContain(corps.motDePasseTemporaireEnClair)
  })

  it('l’identité vient de la LICENCE, jamais du corps', async () => {
    await ouvrir()
    const envoye = h.post.mock.calls[0][1]
    expect(envoye.garageLicense).toBe('GF2.licence-garage')
    expect(envoye.account.garageId, 'le garageId du corps ne doit pas exister').toBeUndefined()
  })

  it('publié : l’accès est annoncé prêt, et le client est prévenu', async () => {
    const corps = await (await ouvrir()).json()
    expect(corps.publieEnLigne).toBe(true)
    expect(corps.emailEnvoye).toBe(true)
    expect(h.mails).toHaveLength(1)
  })
})

describe('hors ligne, rien n’est annoncé au client', () => {
  it('la réponse dit que l’accès n’est PAS en ligne, et pourquoi', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const r = await ouvrir()
    const corps = await r.json()
    expect(corps.publieEnLigne, 'c’est ce champ qui empêche l’écran de mentir').toBe(false)
    expect(corps.motifPublication).toBe('HORS_LIGNE')
  })

  it('aucun e-mail n’est envoyé : il porterait un lien vers un refus', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const corps = await (await ouvrir()).json()
    expect(h.mails, 'envoyer les identifiants d’un compte inexistant est pire que ne rien envoyer')
      .toHaveLength(0)
    expect(corps.emailEnvoye).toBe(false)
  })

  it('sans licence garage : dit LICENCE_ABSENTE, sans appel réseau', async () => {
    h.licence = null
    const corps = await (await ouvrir()).json()
    expect(corps.publieEnLigne).toBe(false)
    expect(corps.motifPublication).toBe('LICENCE_ABSENTE')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('adresse déjà prise en ligne : le motif est rendu tel quel', async () => {
    h.post.mockResolvedValue({ ok: false, status: 409, data: { ok: false, code: 'EMAIL_TAKEN_CLOUD' } })
    const corps = await (await ouvrir()).json()
    expect(corps.motifPublication).toBe('EMAIL_TAKEN_CLOUD')
  })

  it('l’accès reste créé LOCALEMENT : c’est lui qu’une republication renverra', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    await ouvrir()
    expect(await prisma.portalUser.count({ where: { clientId } }), 'perdre l’écriture locale obligerait à tout refaire')
      .toBe(1)
  })
})

describe('réinitialiser et désactiver doivent atteindre le service', () => {
  it('une réinitialisation republie ET coupe les sessions en ligne', async () => {
    await ouvrir()
    h.post.mockClear()
    await reinitialiser()
    expect(h.post.mock.calls[0][1]).toMatchObject({ revoquerAppareils: true })
  })

  it('une réinitialisation rattrape une ouverture faite hors ligne', async () => {
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    await ouvrir()
    h.post.mockResolvedValue({ ok: true, status: 200, data: { ok: true } })
    const corps = await (await reinitialiser()).json()
    expect(corps.publieEnLigne, 'c’est le geste de rattrapage proposé au garage').toBe(true)
  })

  it('désactiver coupe aussi les sessions en ligne', async () => {
    await ouvrir()
    h.post.mockClear()
    await basculer(false)
    expect(h.post.mock.calls[0][1]).toMatchObject({ revoquerAppareils: true })
  })

  it('une désactivation qui n’atteint pas le service ne coupe RIEN, et le dit', async () => {
    await ouvrir()
    h.post.mockResolvedValue({ ok: false, code: 'NETWORK' })
    const corps = await (await basculer(false)).json()
    expect(corps.actif).toBe(false)
    expect(corps.publieEnLigne, 'couper localement ne coupe pas le portail').toBe(false)
  })

  it('réactiver ne coupe pas de sessions', async () => {
    await ouvrir()
    await basculer(false)
    h.post.mockClear()
    await basculer(true)
    expect(h.post.mock.calls[0][1]).toMatchObject({ revoquerAppareils: false })
  })
})

describe('le lien de connexion désigne le garage', () => {
  it('l’e-mail porte ?garage=<slug>', async () => {
    await ouvrir()
    // Sans lui, la route de connexion refuse « Garage introuvable ou ambigu » :
    // le client avait les bons identifiants et ne pouvait pas entrer.
    expect(h.mails[0].text).toMatch(/garage=garage-dupont/)
  })
})

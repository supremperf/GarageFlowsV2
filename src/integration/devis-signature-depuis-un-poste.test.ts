/**
 * GF-003 — « faire signer le devis » depuis un POSTE installé produisait un lien
 * mort, un e-mail parti dans le vide et un devis marqué « envoyé ».
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `/api/quotes/[id]/signature-token` signe le jeton avec `portalSecret()`, qui
 * sur un poste packagé vaut le secret D'INSTALLATION (256 bits tirés au hasard
 * et rangés dans userData — `electron/secret.js` ; le `.env` est retiré du
 * paquet). L'URL remise au client, elle, pointe TOUJOURS sur la PWA officielle
 * (`src/lib/public-url.ts`, à dessein : une URL LAN serait inutilisable hors de
 * l'atelier).
 *
 * Le client ouvrait donc `app.garageflows.fr/clients/quote/<jeton>` et le cloud
 * y répondait « Token invalide ou expiré » — deux fois plutôt qu'une :
 *   - il ne connaît pas le secret qui a signé ce jeton ;
 *   - et il n'a pas le devis : la passerelle poste → cloud (`/api/sync/*`) ne
 *     porte que les interventions, leurs photos, les mécaniciens et
 *     l'instantané portail. Aucun devis n'est répliqué.
 *
 * Pendant ce temps le garage voyait « Devis envoyé à … », le devis passait de
 * « brouillon » à « envoyé », et l'e-mail contenant le lien mort était parti.
 *
 * ─── Ce qui est corrigé ici, et ce qui ne l'est pas ─────────────────────────
 * CORRIGÉ : plus de faux succès, plus d'e-mail dans le vide, plus de changement
 * d'état pour une signature qui ne peut pas avoir lieu. Le refus est explicite.
 *
 * PAS CORRIGÉ (fonctionnalité manquante, signalée comme telle) : faire signer un
 * devis À DISTANCE depuis un poste. Cela demande une vraie voie de retour —
 * publication du devis au cloud puis remontée de l'accord signé vers le SQLite
 * du poste — c'est-à-dire l'équivalent de `/api/sync/portal` dans les DEUX sens.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-devis-signature-poste.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-de-test-signature-devis-0123456789abcdef'
process.env.NEXTAUTH_SECRET = 'secret-de-test-signature-devis-0123456789abcdef'

const h = vi.hoisted(() => ({
  session: null as any,
  /** Instance courante : poste (SQLite) ou cloud. */
  poste: true,
  /** Courriels réellement demandés au module d'envoi. */
  courriels: [] as Array<{ to: string; subject: string; text: string }>,
}))

vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) {
        if (e instanceof Response) return e
        return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } })
      }
    },
  requireSession: async () => h.session,
}))

// Le commutateur EXACT sous test : « suis-je un poste ? ». La base reste réelle.
vi.mock('@/lib/sync/cloud-client', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/sync/cloud-client')>()
  return { ...reel, isDesktopInstance: () => h.poste }
})

// L'envoi est intercepté pour PROUVER qu'aucun courriel ne part sur le chemin
// refusé — et non pour éviter un envoi réel.
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: { to: string; subject: string; text: string }) => {
    h.courriels.push({ to: m.to, subject: m.subject, text: m.text })
    return { ok: true }
  },
}))

let prisma: any
let POST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', devis: '' }

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/quotes/[id]/signature-token/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Recette', slug: 'garage-recette' } })
  ids.garage = garage.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const suffixe of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${suffixe}`, { force: true })
})

beforeEach(async () => {
  h.courriels = []
  await prisma.quote.deleteMany({})
  const devis = await prisma.quote.create({
    data: {
      number: 'D-2026-001', status: 'draft', issueDate: '2026-08-14',
      clientName: 'Jean Client', clientEmail: 'jean@example.test',
      garageId: ids.garage, taxRate: 20,
      lines: {
        create: [{
          description: 'Vidange moteur',
          quantityTenThousandths: 10_000,
          unitPriceTenThousandths: 900_000,
          unitCostTenThousandths: 400_000,
          isLabor: true, sortOrder: 0,
        }],
      },
    },
  })
  ids.devis = devis.id
})

const demander = () =>
  POST(new Request('http://localhost/api/quotes/x/signature-token', { method: 'POST' }), { params: { id: ids.devis } })

describe('signature de devis — depuis un POSTE installé (GF-003)', () => {
  beforeEach(() => { h.poste = true })

  it('refuse explicitement au lieu de produire un lien illisible', async () => {
    const res = await demander()
    expect(res.status).toBe(409)
    const corps = await res.json()
    expect(corps.code).toBe('SIGNATURE_DISTANTE_INDISPONIBLE')
    expect(corps.error, 'le motif doit être compréhensible par le garage').toMatch(/poste installé/i)
    expect(corps.token, 'aucun jeton ne doit sortir').toBeUndefined()
    expect(corps.url, 'aucune URL ne doit sortir').toBeUndefined()
  })

  it('ne fait PAS basculer le devis en « envoyé »', async () => {
    await demander()
    const apres = await prisma.quote.findUnique({ where: { id: ids.devis }, select: { status: true } })
    expect(apres.status, 'un devis qui ne peut pas être signé n’est pas « envoyé »').toBe('draft')
  })

  it('n’envoie AUCUN courriel', async () => {
    await demander()
    expect(h.courriels, 'un lien mort ne doit jamais partir chez le client').toEqual([])
  })
})

describe('signature de devis — sur l’espace en ligne (comportement préservé)', () => {
  beforeEach(() => { h.poste = false })

  it('produit le lien, marque le devis « envoyé » et l’envoie au client', async () => {
    const res = await demander()
    expect(res.status).toBe(200)
    const corps = await res.json()

    expect(typeof corps.token).toBe('string')
    expect(corps.url).toMatch(/^https:\/\/app\.garageflows\.fr\/clients\/quote\//)
    expect(corps.emailEnvoye).toBe(true)
    expect(corps.destinataire).toBe('jean@example.test')

    const apres = await prisma.quote.findUnique({ where: { id: ids.devis }, select: { status: true } })
    expect(apres.status).toBe('sent')

    expect(h.courriels).toHaveLength(1)
    expect(h.courriels[0].to).toBe('jean@example.test')
    expect(h.courriels[0].text, 'le courriel doit porter le lien').toContain(corps.url)
  })

  it('le jeton produit est bien celui que la page de signature accepte', async () => {
    // Preuve de bout en bout : le jeton n'est pas seulement « une chaîne », il
    // est réellement résolu par le handler public du portail.
    const { url, token } = await (await demander()).json()
    expect(url).toContain(token)

    const { GET } = (await import('@/app/api/portal/quote/[token]/route')) as any
    const lecture = await GET(new Request('http://x'), { params: { token } })
    expect(lecture.status).toBe(200)
    expect((await lecture.json()).number).toBe('D-2026-001')
  })
})

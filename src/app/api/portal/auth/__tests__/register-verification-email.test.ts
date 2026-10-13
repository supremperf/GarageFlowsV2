/**
 * GF31-AUD-018 — le lien de vérification d'e-mail doit être RÉELLEMENT envoyé.
 *
 * L'inscription au portail générait un `emailVerifyToken`, le stockait, et
 * commentait : « stored (never returned) for later dispatch via the garage's
 * mail pipeline ». Cet envoi n'existait nulle part.
 *
 * Conséquence en chaîne : le client ne recevait rien, ne pouvait donc jamais
 * atteindre `/api/portal/auth/verify-email`, et `PortalUser.clientId` restait
 * NULL indéfiniment — or c'est ce rattachement, volontairement différé jusqu'à
 * la preuve de possession de l'adresse, qui donne accès aux devis, factures et
 * véhicules. Le portail client était donc vide pour tout le monde, par
 * construction.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.NEXTAUTH_URL = 'https://app.garageflows.fr'

const cap = vi.hoisted(() => ({
  utilisateurs: [] as Array<Record<string, unknown>>,
  courriels: [] as Array<Record<string, unknown>>,
  envoiOk: true,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    garage: { findMany: async () => [{ id: 'gA' }], findUnique: async () => ({ id: 'gA' }) },
    portalUser: {
      findUnique: async () => null,
      create: async (a: { data: Record<string, unknown> }) => {
        cap.utilisateurs.push(a.data)
        return { id: 'pu1', email: a.data.email, name: a.data.name, emailVerified: false, clientId: null }
      },
    },
  },
  isPostgresDatabase: () => false,
}))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  clientIpFrom: () => '127.0.0.1',
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('@/lib/mail/send-garage-mail', () => ({
  sendGarageMail: async (m: Record<string, unknown>) => {
    cap.courriels.push(m)
    return cap.envoiOk
      ? { ok: true }
      : { ok: false, reason: 'SMTP_NOT_CONFIGURED', message: 'Aucune configuration SMTP complète pour ce garage.' }
  },
}))

let POST: (req: Request) => Promise<Response>
beforeAll(async () => { POST = (await import('@/app/api/portal/auth/register/route')).POST as never })

function inscription(corps: Record<string, unknown> = {}) {
  return new Request('http://x/api/portal/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'client@example.fr', password: 'motdepasse-solide', name: 'Jean', ...corps }),
  })
}

beforeEach(() => {
  cap.utilisateurs = []
  cap.courriels = []
  cap.envoiOk = true
})

describe('GF31-AUD-018 — envoi du lien de vérification', () => {
  it('envoie un courriel à l’adresse inscrite', async () => {
    const res = await POST(inscription())
    expect(res.status).toBe(201)
    expect(cap.courriels).toHaveLength(1)
    expect(cap.courriels[0].to).toBe('client@example.fr')
    expect(cap.courriels[0].garageId).toBe('gA')
  })

  it('le courriel contient le lien porteur du JETON RÉELLEMENT stocké', async () => {
    await POST(inscription())
    const jetonStocke = String(cap.utilisateurs[0].emailVerifyToken)
    expect(jetonStocke).toMatch(/^[0-9a-f]{64}$/)

    const texte = String(cap.courriels[0].text)
    expect(texte).toContain('/api/portal/auth/verify-email?token=')
    expect(texte).toContain(jetonStocke)
  })

  it('annonce honnêtement l’envoi dans la réponse', async () => {
    const body = await (await POST(inscription())).json()
    expect(body.verificationEmailSent).toBe(true)
    expect(body.requiresEmailVerification).toBe(true)
  })

  it('un SMTP non configuré n’empêche pas l’inscription, et ne prétend PAS avoir envoyé', async () => {
    cap.envoiOk = false
    const res = await POST(inscription())
    expect(res.status).toBe(201) // le compte est bien créé

    const body = await res.json()
    expect(body.verificationEmailSent).toBe(false)
    expect(body.verificationEmailError).toMatch(/SMTP/i)
  })

  it('ne renvoie JAMAIS le jeton au client', async () => {
    const body = await (await POST(inscription())).json()
    const jetonStocke = String(cap.utilisateurs[0].emailVerifyToken)
    expect(JSON.stringify(body)).not.toContain(jetonStocke)
  })
})

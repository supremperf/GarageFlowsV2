/**
 * POST /api/plate-ocr — reconnaissance d'immatriculation par modèle de langage.
 *
 * C'est le seul endroit du logiciel où une sortie de modèle est présentée à
 * l'utilisateur comme une LECTURE. Ces tests vérifient la seule chose qui compte
 * ici : que rien de ce que le modèle a pu inventer ne ressorte comme une plaque.
 *
 * Le SDK Anthropic est simulé — appeler la vraie API dans une suite de tests
 * coûterait de l'argent, dépendrait du réseau, et rendrait le résultat
 * non déterministe. Ce qui est éprouvé, c'est le TRAITEMENT de la réponse.
 *
 * RÉSERVE : la qualité de lecture du modèle sur de vraies photos de plaques
 * n'est pas mesurée ici et reste NOT_VERIFIED — elle exige une campagne de
 * photos réelles et une clé API (BLOCKED_EXTERNAL_REQUIREMENT).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

const h = vi.hoisted(() => ({
  reponse: 'AB-123-CD' as string | null,
  lance: null as Error | null,
  creees: [] as unknown[],
  logs: [] as unknown[][],
}))

vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'u-1', role: 'OWNER', garageId: 'g-1' } }),
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => h.logs.push(a),
    warn: (...a: unknown[]) => h.logs.push(a),
    info: (...a: unknown[]) => h.logs.push(a),
    debug: (...a: unknown[]) => h.logs.push(a),
  },
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(o: unknown) { h.creees.push(o) }
    messages = {
      create: async () => {
        if (h.lance) throw h.lance
        return { content: h.reponse === null ? [] : [{ type: 'text', text: h.reponse }] }
      },
    }
  },
}))

let POST: (req: Request) => Promise<Response>

const IMAGE = `data:image/jpeg;base64,${'A'.repeat(64)}`

const envoyer = (corps: unknown = { imageBase64: IMAGE }) =>
  POST(new Request('http://localhost/api/plate-ocr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  }))

beforeAll(async () => {
  ;({ POST } = (await import('@/app/api/plate-ocr/route')) as any)
})

beforeEach(() => {
  h.reponse = 'AB-123-CD'
  h.lance = null
  h.creees = []
  h.logs = []
  process.env.ANTHROPIC_API_KEY = 'cle-de-test-non-reelle'
})

describe('une plaque lue est rendue, mise en forme', () => {
  it('le format SIV ressort normalisé', async () => {
    h.reponse = 'ab 123 cd'
    const r = await envoyer()
    expect(r.status).toBe(200)
    expect((await r.json()).plate).toBe('AB-123-CD')
  })

  it('le format FNI est accepté : les véhicules d’avant 2009 roulent encore', async () => {
    h.reponse = '1234 AB 75'
    expect((await (await envoyer()).json()).plate).toBe('1234-AB-75')
  })
})

describe('rien de ce que le modèle invente ne ressort comme une plaque', () => {
  it('une phrase du modèle est refusée, pas recopiée', async () => {
    h.reponse = 'Je ne distingue pas la plaque sur cette photo'
    const r = await envoyer()
    expect(r.status, 'sans ce refus, la phrase partait dans la facture').toBe(422)
    const corps = await r.json()
    expect(corps.plate, 'aucune plaque ne doit être rendue').toBeUndefined()
    expect(corps.error).toBe('Plaque non détectée')
  })

  it('un refus poli en anglais est refusé lui aussi', async () => {
    h.reponse = 'Sorry, I cannot read this image'
    expect((await envoyer()).status).toBe(422)
  })

  it('une réponse vide est refusée', async () => {
    h.reponse = null
    expect((await envoyer()).status).toBe(422)
  })

  it('une immatriculation malformée est refusée plutôt que devinée', async () => {
    h.reponse = 'AB-12-CD'
    expect((await envoyer()).status, 'compléter le chiffre manquant inventerait un véhicule').toBe(422)
  })
})

describe('pannes et configuration', () => {
  it('sans clé API : 503, et aucun appel au fournisseur', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const r = await envoyer()
    expect(r.status).toBe(503)
    expect(h.creees, 'rien ne doit être tenté sans clé').toHaveLength(0)
  })

  it('une panne du fournisseur donne 503, jamais l’erreur brute', async () => {
    h.lance = new Error('401 {"type":"error","error":{"message":"invalid x-api-key"}}')
    const r = await envoyer()
    expect(r.status).toBe(503)
    const corps = await r.json()
    expect(JSON.stringify(corps), 'le message du fournisseur ne doit pas ressortir')
      .not.toMatch(/x-api-key|invalid/i)
  })

  it('la panne est journalisée par le logger qui rédige, pas par console', async () => {
    h.lance = new Error('panne')
    await envoyer()
    // `console.error` contournerait la rédaction centralisée (§15) : une erreur
    // de SDK peut transporter des en-têtes de requête.
    expect(h.logs.length, 'la trace doit passer par @/lib/logger').toBeGreaterThan(0)
  })

  it('une image trop lourde est refusée avant tout appel payant', async () => {
    const r = await envoyer({ imageBase64: `data:image/jpeg;base64,${'A'.repeat(6_000_001)}` })
    expect(r.status).toBe(413)
    expect(h.creees, 'facturer un appel pour une image hors borne serait absurde').toHaveLength(0)
  })

  it('un corps sans image est refusé', async () => {
    expect((await envoyer({})).status).toBe(400)
  })

  it('un format d’image non reconnu est refusé avant l’appel', async () => {
    const r = await envoyer({ imageBase64: 'pas-une-image' })
    expect(r.status).toBe(400)
    expect(h.creees).toHaveLength(0)
  })
})

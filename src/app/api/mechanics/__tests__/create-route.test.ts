/**
 * POST /api/mechanics — ajout d'un mécanicien.
 *
 * Cause racine corrigée : le client envoie `specialty` en TABLEAU (['freins', …])
 * alors que CreateMechanicSchema exigeait une chaîne → Zod rejetait (400) → toast
 * générique « Erreur lors de l'ajout ». Le schéma accepte désormais tableau OU
 * chaîne, et la route mappe les erreurs en messages clairs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authState = vi.hoisted(() => ({ role: 'OWNER', garageId: 'gA', id: 'owner1' }))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: authState.id, role: authState.role, garageId: authState.garageId } }),
  withAuth:
    (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))

const dbState = vi.hoisted(() => ({
  count: 0,
  created: null as Record<string, unknown> | null,
  throws: null as { code?: string } | null,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    mechanic: {
      count: async () => dbState.count,
      // Le roster sert au comptage (order) ET au dé-doublonnage applicatif. On
      // renvoie des noms fictifs qui ne collisionnent avec aucun nom de test.
      findMany: async () => Array.from({ length: dbState.count }, (_, i) => ({ name: `__existing_${i}` })),
      create: async (args: { data: Record<string, unknown> }) => {
        if (dbState.throws) throw dbState.throws
        dbState.created = args.data
        return { id: 'mech-1', ...args.data }
      },
    },
  },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { POST } from '@/app/api/mechanics/route'

function call(body: unknown) {
  const req = new Request('http://127.0.0.1/api/mechanics', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return (POST as unknown as (r: Request) => Promise<Response>)(req)
}

beforeEach(() => {
  authState.role = 'OWNER'; authState.garageId = 'gA'; authState.id = 'owner1'
  dbState.count = 0; dbState.created = null; dbState.throws = null
})

describe('POST /api/mechanics', () => {
  it('nom valide + spécialités (TABLEAU) → 201, specialty stocké en JSON', async () => {
    const res = await call({ name: 'Thomas Bernard', color: '#3b82f6', specialty: ['freins', 'pneus'], avatar: 'TB' })
    expect(res.status).toBe(201)
    expect(dbState.created?.specialty).toBe('["freins","pneus"]')
    expect(dbState.created?.name).toBe('Thomas Bernard')
  })

  it('tableau de spécialités vide → 201', async () => {
    const res = await call({ name: 'Alice', color: '#10b981', specialty: [], avatar: 'AL' })
    expect(res.status).toBe(201)
    expect(dbState.created?.specialty).toBe('[]')
  })

  it('sans champ specialty (facultatif) → 201', async () => {
    const res = await call({ name: 'Bob', color: '#f59e0b', avatar: 'BO' })
    expect(res.status).toBe(201)
    expect(dbState.created?.specialty).toBe('[]')
  })

  it('nom avec accents / apostrophe / tiret → 201', async () => {
    const res = await call({ name: "Jean-Rémi O'Néill", color: '#8b5cf6', specialty: ['moteur'] })
    expect(res.status).toBe(201)
    expect(dbState.created?.name).toBe("Jean-Rémi O'Néill")
  })

  it("nom uniquement composé d'espaces → 400", async () => {
    const res = await call({ name: '   ', color: '#3b82f6' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/obligatoire/i)
  })

  it('couleur invalide → 400', async () => {
    const res = await call({ name: 'X', color: 'blue' })
    expect(res.status).toBe(400)
  })

  it('rôle non autorisé → 403', async () => {
    authState.role = 'MECHANIC'
    const res = await call({ name: 'X', color: '#3b82f6' })
    expect(res.status).toBe(403)
  })

  it('garageId provient de la SESSION, jamais du corps (isolation)', async () => {
    const res = await call({ name: 'X', color: '#3b82f6', garageId: 'gEVIL' })
    expect(res.status).toBe(201)
    expect(dbState.created?.garageId).toBe('gA')
  })

  it('specialty en chaîne JSON aussi acceptée → 201', async () => {
    const res = await call({ name: 'Y', color: '#3b82f6', specialty: '["diagnostics"]' })
    expect(res.status).toBe(201)
    expect(dbState.created?.specialty).toBe('["diagnostics"]')
  })

  it('doublon (P2002) → 409', async () => {
    dbState.throws = { code: 'P2002' }
    const res = await call({ name: 'Z', color: '#3b82f6' })
    expect(res.status).toBe(409)
  })

  it('erreur base de données → 500 (message générique, aucun détail technique)', async () => {
    dbState.throws = { code: 'P1001' }
    const res = await call({ name: 'W', color: '#3b82f6' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Réessayez/i)
  })

  it('avatar dérivé du nom si absent', async () => {
    const res = await call({ name: 'John Richard', color: '#3b82f6' })
    expect(res.status).toBe(201)
    expect(dbState.created?.avatar).toBe('JO')
  })

  it('order = count + 1 (position en fin de liste)', async () => {
    dbState.count = 4
    const res = await call({ name: 'Cinq', color: '#3b82f6' })
    expect(res.status).toBe(201)
    expect(dbState.created?.order).toBe(5)
  })
})

/**
 * Stock transactionnel — route /api/jobs/[id]/parts.
 *
 * Vérifie les invariants critiques (Phase 6) avec une base simulée en mémoire :
 *  - validation des quantités ;
 *  - déduction du stock à la CRÉATION et à l'AUGMENTATION d'une ligne (le
 *    supplément est bien déduit — bug historique) ;
 *  - refus si stock insuffisant (jamais de stock négatif) ;
 *  - restitution exacte à la suppression ;
 *  - isolation garage (anti-IDOR) ;
 *  - décrément conditionnel atomique (course concurrente).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const GARAGE = 'garage-A'

// ── Base simulée (hoistée pour être accessible dans les factories vi.mock) ──────
const H = vi.hoisted(() => {
  interface Part { id: string; garageId: string; quantity: number; unitPrice: number; unitCost: number }
  interface JobPart { id: string; jobId: string; partId: string; quantity: number; unitPrice: number; unitCost: number }
  interface Movement { garageId: string; partId: string; type: string; quantityDelta: number; reason?: string }
  const G = 'garage-A'
  const db = {
    jobs:      [] as { id: string; garageId: string }[],
    parts:     [] as Part[],
    jobParts:  [] as JobPart[],
    movements: [] as Movement[],
    seq: 0,
  }
  const resetDb = () => {
    db.jobs = [{ id: 'job-1', garageId: G }]
    db.parts = [{ id: 'part-1', garageId: G, quantity: 10, unitPrice: 20, unitCost: 12 }]
    db.jobParts = []
    db.movements = []
    db.seq = 0
  }
  const client = {
    job: {
      findFirst: async ({ where }: any) =>
        db.jobs.find(j => j.id === where.id && j.garageId === where.garageId) ?? null,
    },
    part: {
      findFirst: async ({ where }: any) =>
        db.parts.find(p => p.id === where.id && p.garageId === where.garageId) ?? null,
      updateMany: async ({ where, data }: any) => {
        // Émule le décrément/incrément conditionnel atomique.
        const p = db.parts.find(x =>
          x.id === where.id &&
          x.garageId === where.garageId &&
          (where.quantity?.gte === undefined || x.quantity >= where.quantity.gte))
        if (!p) return { count: 0 }
        if (data.quantity?.decrement !== undefined) p.quantity -= data.quantity.decrement
        if (data.quantity?.increment !== undefined) p.quantity += data.quantity.increment
        return { count: 1 }
      },
    },
    jobPart: {
      findFirst: async ({ where }: any) =>
        db.jobParts.find(jp =>
          (where.id === undefined || jp.id === where.id) &&
          (where.jobId === undefined || jp.jobId === where.jobId) &&
          (where.partId === undefined || jp.partId === where.partId) &&
          (where.job?.garageId === undefined || db.jobs.find(j => j.id === jp.jobId)?.garageId === where.job.garageId)
        ) ?? null,
      update: async ({ where, data }: any) => {
        const jp = db.jobParts.find(x => x.id === where.id)!
        // Les trois formes que Prisma accepte. Le simulacre ne connaissait que
        // l'affectation : la route est passée à `{ increment }` pour ne plus
        // dépendre de l'ordre des verrous, et le test échouait sur le simulacre,
        // pas sur le produit.
        if (data.quantity?.increment !== undefined) jp.quantity += data.quantity.increment
        else if (data.quantity?.decrement !== undefined) jp.quantity -= data.quantity.decrement
        else if (data.quantity !== undefined) jp.quantity = data.quantity
        return { ...jp, part: db.parts.find(p => p.id === jp.partId) }
      },
      create: async ({ data }: any) => {
        const jp: JobPart = { id: `jp-${++db.seq}`, ...data }
        db.jobParts.push(jp)
        return { ...jp, part: db.parts.find(p => p.id === jp.partId) }
      },
      delete: async ({ where }: any) => {
        const i = db.jobParts.findIndex(x => x.id === where.id)
        if (i >= 0) db.jobParts.splice(i, 1)
        return {}
      },
    },
    // Journal des mouvements : tout déplacement de stock DOIT y laisser sa
    // trace, y compris ceux venant d'une intervention (GF-028).
    stockMovement: {
      create: async ({ data }: any) => { db.movements.push(data); return data },
    },
  }
  return { db, resetDb, client, role: 'OWNER' as string }
})

const db = H.db
const resetDb = H.resetDb

vi.mock('@/lib/db', () => ({
  prisma: {
    ...H.client,
    $transaction: async (fn: any) => fn(H.client),
  },
}))
// Le rôle manquait : les routes exigent désormais `job:manage` explicitement
// (GF-038), et `can(undefined, …)` refuse — à raison.
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'u1', name: 'U', garageId: GARAGE, role: H.role } }),
  withAuth: (h: any) => h,
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { POST, DELETE } from '@/app/api/jobs/[id]/parts/route'

function post(body: unknown) {
  return POST(new Request('http://127.0.0.1/x', { method: 'POST', body: JSON.stringify(body) }) as never,
    { params: { id: 'job-1' } } as never)
}
function del(body: unknown) {
  return DELETE(new Request('http://127.0.0.1/x', { method: 'DELETE', body: JSON.stringify(body) }) as never,
    { params: { id: 'job-1' } } as never)
}

beforeEach(() => { resetDb(); H.role = 'OWNER'; vi.clearAllMocks() })

describe('droit requis sur les pièces d’intervention (GF-038)', () => {
  it('le COMPTOIR garde l’accès — l’écran le lui propose', async () => {
    // RECEPTIONIST détient `job:manage` : lui imposer `stock:manage`
    // casserait un usage nominal.
    H.role = 'RECEPTIONIST'
    expect((await post({ partId: 'part-1', quantity: 1 })).status).toBe(201)
    expect(db.parts[0].quantity).toBe(9)
  })

  it('un rôle SANS droit sur les interventions est refusé, sans toucher au stock', async () => {
    H.role = 'MECHANIC'
    expect((await post({ partId: 'part-1', quantity: 1 })).status).toBe(403)
    expect(db.parts[0].quantity, 'aucun décrément sur un refus').toBe(10)
    expect(db.movements).toEqual([])
  })

  it('le retrait exige le même droit que l’ajout', async () => {
    await post({ partId: 'part-1', quantity: 2 })
    const id = db.jobParts[0].id
    H.role = 'MECHANIC'
    expect((await del({ jobPartId: id })).status).toBe(403)
    expect(db.parts[0].quantity, 'aucune restitution non plus').toBe(8)
  })
})

describe('stock — ajout de pièce (POST)', () => {
  it('ajout simple : déduit la quantité du stock', async () => {
    const res = await post({ partId: 'part-1', quantity: 3 })
    expect(res.status).toBe(201)
    expect(db.parts[0].quantity).toBe(7)
    expect(db.jobParts[0].quantity).toBe(3)
  })

  it('ajout à une ligne existante : déduit BIEN le supplément (bug historique)', async () => {
    await post({ partId: 'part-1', quantity: 3 })   // stock 10 → 7, ligne = 3
    const res = await post({ partId: 'part-1', quantity: 2 })  // +2
    expect(res.status).toBe(201)
    expect(db.jobParts.length).toBe(1)
    expect(db.jobParts[0].quantity).toBe(5)         // 3 + 2
    expect(db.parts[0].quantity).toBe(5)            // 10 − 3 − 2  (supplément déduit)
  })

  it('stock insuffisant → 409, stock inchangé, aucune ligne créée', async () => {
    const res = await post({ partId: 'part-1', quantity: 999 })
    expect(res.status).toBe(409)
    expect(db.parts[0].quantity).toBe(10)
    expect(db.jobParts.length).toBe(0)
    expect(db.movements, 'un refus ne journalise rien').toEqual([])
  })

  it('le décrément est JOURNALISÉ (GF-028)', async () => {
    // Le stock d'une pièce doit rester reconstituable à partir de
    // `StockMovement` : ce chemin-là n'écrivait rien.
    await post({ partId: 'part-1', quantity: 3 })
    expect(db.movements).toHaveLength(1)
    expect(db.movements[0].quantityDelta).toBe(-3)
    expect(db.movements[0].partId).toBe('part-1')
    expect(db.movements[0].garageId).toBe(GARAGE)
    expect(10 + db.movements.reduce((s, m) => s + m.quantityDelta, 0)).toBe(db.parts[0].quantity)
  })

  it('refuse les quantités invalides (0, négatif, NaN, décimal, absent)', async () => {
    for (const q of [0, -1, 'abc', 2.5, null]) {
      const res = await post({ partId: 'part-1', quantity: q })
      expect(res.status).toBe(400)
    }
    expect(db.parts[0].quantity).toBe(10)
  })

  it('pièce d’un autre garage → 404 (anti-IDOR), stock intact', async () => {
    db.parts.push({ id: 'part-B', garageId: 'garage-B', quantity: 50, unitPrice: 1, unitCost: 1 })
    const res = await post({ partId: 'part-B', quantity: 1 })
    expect(res.status).toBe(404)
    expect(db.parts.find(p => p.id === 'part-B')!.quantity).toBe(50)
  })

  it('deux ajouts concurrents ne consomment jamais plus que le stock', async () => {
    db.parts[0].quantity = 5
    // 3 requêtes de 2 pièces : au plus 2 réussissent (5/2 = 2), la 3e échoue.
    const results = await Promise.all([
      post({ partId: 'part-1', quantity: 2 }),
      post({ partId: 'part-1', quantity: 2 }),
      post({ partId: 'part-1', quantity: 2 }),
    ])
    const ok = results.filter(r => r.status === 201).length
    expect(ok).toBe(2)
    expect(db.parts[0].quantity).toBe(1)   // 5 − 2 − 2, jamais négatif
    expect(db.parts[0].quantity).toBeGreaterThanOrEqual(0)
  })
})

describe('stock — suppression de ligne (DELETE)', () => {
  it('restitue exactement la quantité et supprime la ligne', async () => {
    await post({ partId: 'part-1', quantity: 4 })   // stock → 6
    const jpId = db.jobParts[0].id
    const res = await del({ jobPartId: jpId })
    expect(res.status).toBe(200)
    expect(db.parts[0].quantity).toBe(10)           // restitué
    expect(db.jobParts.length).toBe(0)
    // Mouvements symétriques : l'aller-retour laisse un solde nul, pas un blanc.
    expect(db.movements.map(m => m.quantityDelta)).toEqual([-4, 4])
  })

  it('ligne d’un autre garage → 404, aucun stock restitué', async () => {
    db.jobs.push({ id: 'job-B', garageId: 'garage-B' })
    db.jobParts.push({ id: 'jp-x', jobId: 'job-B', partId: 'part-1', quantity: 3, unitPrice: 1, unitCost: 1 })
    const res = await del({ jobPartId: 'jp-x' })
    expect(res.status).toBe(404)
    expect(db.parts[0].quantity).toBe(10)
    expect(db.movements, 'un refus ne journalise rien').toEqual([])
  })
})

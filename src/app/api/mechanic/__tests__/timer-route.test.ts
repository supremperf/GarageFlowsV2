/**
 * /api/mechanic/jobs/[id]/timer — corrections §7 (écriture atomique re-scopée)
 * et §8 (pas d'auto-clôture : statut intermédiaire, completed uniquement opt-in).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  updateManyResult: { count: 1 } as { count: number },
  lastUpdateMany: null as Record<string, unknown> | null,
  finalJob: { id: 'J1', status: 'in_progress', timerStartedAt: null, actualDuration: 10 } as Record<string, unknown>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    job: {
      updateMany: async (args: Record<string, unknown>) => { state.lastUpdateMany = args; return state.updateManyResult },
      findFirst: async () => state.finalJob,
    },
  },
}))
vi.mock('@/lib/mechanic-api', () => ({
  requireMechanic: async () => ({ garageId: 'gA', mechanicId: 'M1', licenseId: 'L1', deviceId: null }),
  withMechanic: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
  findAssignedJob: async () => state.job,
  logMechanicAction: async () => {},
}))

import { POST } from '@/app/api/mechanic/jobs/[id]/timer/route'

function call(action: string) {
  const req = new Request('http://127.0.0.1/api/mechanic/jobs/J1/timer', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
  })
  return (POST as unknown as (r: Request, c: { params: { id: string } }) => Promise<Response>)(req, { params: { id: 'J1' } })
}

beforeEach(() => {
  state.job = { id: 'J1', timerStartedAt: new Date('2026-01-01T10:00:00Z'), actualDuration: 10 }
  state.updateManyResult = { count: 1 }
  state.lastUpdateMany = null
  delete process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE
})
afterEach(() => { delete process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE })

describe('§8 — pas d\'auto-clôture', () => {
  it('stop (défaut) → statut intermédiaire awaiting_validation (jamais completed)', async () => {
    const res = await call('stop')
    expect(res.status).toBe(200)
    expect((state.lastUpdateMany!.data as Record<string, unknown>).status).toBe('awaiting_validation')
  })
  it('stop avec GF_MECHANIC_TIMER_AUTOCOMPLETE=1 → completed (opt-in explicite)', async () => {
    process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE = '1'
    await call('stop')
    expect((state.lastUpdateMany!.data as Record<string, unknown>).status).toBe('completed')
  })
  it('stop accumule le temps (n\'écrase pas actualDuration)', async () => {
    await call('stop')
    // existing 10 + elapsed (>=0) : le champ additionne
    expect((state.lastUpdateMany!.data as Record<string, unknown>).actualDuration as number).toBeGreaterThanOrEqual(10)
  })
})

describe('§7 — écriture atomique re-scopée', () => {
  it('stop : la garde re-vérifie garageId + mechanicId + timerStartedAt', async () => {
    await call('stop')
    const where = state.lastUpdateMany!.where as Record<string, unknown>
    expect(where.garageId).toBe('gA')
    expect(where.mechanicId).toBe('M1')
    expect(where.timerStartedAt).toBeInstanceOf(Date) // garde optimiste
  })
  it('stop : réattribution/double-stop concurrent (count 0) → 409, pas d\'écriture fantôme', async () => {
    state.updateManyResult = { count: 0 }
    expect((await call('stop')).status).toBe(409)
  })
  it('start : la garde inclut garageId + mechanicId', async () => {
    await call('start')
    const where = state.lastUpdateMany!.where as Record<string, unknown>
    expect(where.garageId).toBe('gA')
    expect(where.mechanicId).toBe('M1')
  })
  it('start : réattribué entre-temps (count 0) → 409', async () => {
    state.updateManyResult = { count: 0 }
    expect((await call('start')).status).toBe(409)
  })
  it('stop sans timer démarré → 400', async () => {
    state.job = { id: 'J1', timerStartedAt: null, actualDuration: 0 }
    expect((await call('stop')).status).toBe(400)
  })
  it('job non attribué (findAssignedJob null) → 404', async () => {
    state.job = null
    expect((await call('start')).status).toBe(404)
  })
})

/**
 * §6 — Chrono mécanicien : pause/reprise sans perte, garde durée négative,
 * anti double-démarrage. Horloge figée (vi.setSystemTime) pour un résultat exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const NOW = new Date('2026-06-01T12:00:00.000Z')

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  updateManyResult: { count: 1 } as { count: number },
  lastUpdate: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    job: {
      updateMany: async (a: Record<string, unknown>) => { state.lastUpdate = a; return state.updateManyResult },
      findFirst: async () => ({ id: 'J1', status: 'in_progress', timerStartedAt: null, actualDuration: 0, timerAccumulatedSec: 0 }),
    },
  },
}))
vi.mock('@/lib/mechanic-api', () => ({
  requireMechanic: async () => ({ garageId: 'gA', mechanicId: 'M1', licenseId: 'L1', deviceId: null }),
  withMechanic: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => { try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e } },
  findAssignedJob: async () => state.job,
  logMechanicAction: async () => {},
}))

import { POST } from '@/app/api/mechanic/jobs/[id]/timer/route'

const data = () => state.lastUpdate!.data as Record<string, unknown>
function call(action: string) {
  const req = new Request('http://127.0.0.1/t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
  return (POST as unknown as (r: Request, c: { params: { id: string } }) => Promise<Response>)(req, { params: { id: 'J1' } })
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  state.updateManyResult = { count: 1 }; state.lastUpdate = null
})
afterEach(() => { vi.useRealTimers(); delete process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE })

describe('§6 — anti double-démarrage', () => {
  it('start quand un segment est déjà en cours (updateMany count 0) → 409, pas de réinitialisation', async () => {
    state.job = { id: 'J1', timerStartedAt: new Date(NOW.getTime() - 60_000), actualDuration: 0, timerAccumulatedSec: 0 }
    state.updateManyResult = { count: 0 } // where timerStartedAt:null ne matche pas → double-clic bloqué
    expect((await call('start')).status).toBe(409)
  })
  it('start (frais) exige timerStartedAt null dans le where', async () => {
    state.job = { id: 'J1', timerStartedAt: null, actualDuration: 0, timerAccumulatedSec: 0 }
    await call('start')
    expect((state.lastUpdate!.where as Record<string, unknown>).timerStartedAt).toBeNull()
    expect(data().status).toBe('in_progress')
  })
})

describe('§6 — pause / reprise sans perte', () => {
  it('pause fige le segment en cours dans timerAccumulatedSec (aucune seconde perdue)', async () => {
    state.job = { id: 'J1', timerStartedAt: new Date(NOW.getTime() - 90_000), actualDuration: 0, timerAccumulatedSec: 30 }
    await call('pause')
    // 30 (déjà accumulé) + 90 s (segment) = 120
    expect(data().timerAccumulatedSec).toBe(120)
    expect(data().timerStartedAt).toBeNull()
  })
  it('pause sans chrono démarré → 400', async () => {
    state.job = { id: 'J1', timerStartedAt: null, actualDuration: 0, timerAccumulatedSec: 0 }
    expect((await call('pause')).status).toBe(400)
  })
  it('resume rouvre un segment (timerStartedAt = maintenant)', async () => {
    state.job = { id: 'J1', timerStartedAt: null, actualDuration: 0, timerAccumulatedSec: 120 }
    await call('resume')
    expect(data().timerStartedAt).toBeInstanceOf(Date)
    expect(data().status).toBe('in_progress')
  })
  it('stop depuis la pause : minutes dérivées du total accumulé', async () => {
    state.job = { id: 'J1', timerStartedAt: null, actualDuration: 0, timerAccumulatedSec: 150 } // 150 s → 3 min (arrondi)
    await call('stop')
    expect(data().actualDuration).toBe(Math.round(150 / 60)) // 3
    expect(data().timerAccumulatedSec).toBe(0) // transféré vers actualDuration
    expect(data().status).toBe('awaiting_validation')
  })
  it('stop en cours : accumulé + segment courant', async () => {
    state.job = { id: 'J1', timerStartedAt: new Date(NOW.getTime() - 90_000), actualDuration: 2, timerAccumulatedSec: 30 }
    await call('stop')
    // total = 30 + 90 = 120 s → 2 min ; actualDuration = 2 (existant) + 2 = 4
    expect(data().actualDuration).toBe(4)
  })
})

describe('§6 — durée jamais négative (recul d\'horloge)', () => {
  it('timerStartedAt dans le FUTUR → segment clampé à 0, actualDuration ne diminue pas', async () => {
    state.job = { id: 'J1', timerStartedAt: new Date(NOW.getTime() + 120_000), actualDuration: 5, timerAccumulatedSec: 0 }
    await call('stop')
    // segment = max(0, -120) = 0 ; total = 0 ; actualDuration = 5 + 0 = 5 (inchangé, jamais négatif)
    expect(data().actualDuration).toBe(5)
  })
})

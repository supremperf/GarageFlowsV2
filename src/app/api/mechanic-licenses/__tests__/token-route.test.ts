/**
 * /api/mechanic-licenses/[lid]/token — correction §9 : POST (jamais GET),
 * réauthentification par mot de passe, en-têtes no-store, audit sans le token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

const PASSWORD = 'owner-correct-pw'
const HASH = bcrypt.hashSync(PASSWORD, 10)

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  license: null as Record<string, unknown> | null,
  audits: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: async () => state.user },
    licenseKey: { findFirst: async () => state.license },
    mechanicActionAudit: { create: async (a: { data: Record<string, unknown> }) => { state.audits.push(a.data); return a.data } },
  },
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner1', role: 'OWNER', garageId: 'gA' } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import * as route from '@/app/api/mechanic-licenses/[lid]/token/route'

function call(password: unknown) {
  const req = new Request('http://127.0.0.1/api/mechanic-licenses/L1/token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
  })
  return (route.POST as unknown as (r: Request, c: { params: { lid: string } }) => Promise<Response>)(req, { params: { lid: 'L1' } })
}

beforeEach(() => {
  state.user = { password: HASH }
  state.license = { licenseId: 'L1', token: 'FULL-TOKEN-SECRET', mechanicId: 'M1' }
  state.audits = []
})

describe('§9 — récupération protégée du token', () => {
  it('la route n\'expose PLUS de GET (token hors URL)', () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined()
    expect(typeof route.POST).toBe('function')
  })

  it('mauvais mot de passe → 401 REAUTH_REQUIRED, aucun token, audit token_copy_denied', async () => {
    const res = await call('mauvais')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('REAUTH_REQUIRED')
    expect(body.token).toBeUndefined()
    expect(state.audits.at(-1)!.action).toBe('token_copy_denied')
  })

  it('bon mot de passe → 200 + token dans le CORPS + en-têtes no-store + audit token_copied', async () => {
    const res = await call(PASSWORD)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('FULL-TOKEN-SECRET')
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(res.headers.get('Pragma')).toBe('no-cache')
    const a = state.audits.at(-1)!
    expect(a.action).toBe('token_copied')
    expect(a.actorUserId).toBe('owner1')
    expect(a.targetMechanicId).toBe('M1')
  })

  it('mot de passe absent → 401 (réauth obligatoire)', async () => {
    expect((await call(undefined)).status).toBe(401)
  })
})

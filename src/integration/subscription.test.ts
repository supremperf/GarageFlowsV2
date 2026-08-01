/**
 * Abonnement — test d'intégration SQLite : persistance (upsert depuis un état
 * externe) + décision d'accès serveur reflétant l'état stocké, scopée garageId.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-sub.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let svc: typeof import('@/lib/billing/service')
let garageA: string
let garageB: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  svc = await import('@/lib/billing/service')
  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
}, 40_000)

afterAll(() => { try { fs.rmSync(DB_PATH) } catch { /* ignore */ } })

describe('service abonnement', () => {
  it('sans abonnement → accès refusé', async () => {
    expect((await svc.getAccess(garageA)).allowed).toBe(false)
  })

  it('upsert depuis un état externe « active » → accès autorisé', async () => {
    await svc.upsertFromExternal(garageA, {
      externalStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
      externalCustomerId: 'cus_A',
    })
    const d = await svc.getAccess(garageA)
    expect(d.allowed).toBe(true)
    expect(d.effectiveStatus).toBe('active')
  })

  it('upsert « canceled » → accès refusé (idempotent sur garageId)', async () => {
    await svc.upsertFromExternal(garageA, { externalStatus: 'canceled' })
    expect((await svc.getAccess(garageA)).allowed).toBe(false)
    expect(await prisma.subscription.count({ where: { garageId: garageA } })).toBe(1) // pas de doublon
  })

  it('la décision est scopée par garage (B non affecté par A)', async () => {
    await svc.upsertFromExternal(garageB, { externalStatus: 'trialing', trialEndsAt: new Date(Date.now() + 5 * 864e5) })
    expect((await svc.getAccess(garageB)).allowed).toBe(true)
    expect((await svc.getAccess(garageA)).allowed).toBe(false) // A reste annulé
  })
})

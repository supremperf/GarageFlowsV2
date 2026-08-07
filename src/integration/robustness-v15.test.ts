/**
 * Robustesse V15 (P2 — base SQLite réelle) — trois corrections :
 *  1. labor-operations/bulk-import : tableau borné (anti-DoS) ;
 *  2. appointments/[id] : transition de statut ATOMIQUE (anti-TOCTOU) — deux
 *     actions concurrentes ne peuvent pas s'écraser ;
 *  3. mechanics : dé-doublonnage RÉEL au niveau applicatif (le handler P2002
 *     ne se déclenchait jamais faute de contrainte d'unicité en base).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-robustness-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let bulkImport: (req: Request) => Promise<Response>
let apptAction: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let mechPost: (req: Request) => Promise<Response>
const ctx = { garageId: '' }

const jreq = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: bulkImport } = (await import('@/app/api/labor-operations/bulk-import/route')) as any)
  ;({ POST: apptAction } = (await import('@/app/api/appointments/[id]/route')) as any)
  ;({ POST: mechPost } = (await import('@/app/api/mechanics/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'RB', slug: 'robustness-v15' } })
  ctx.garageId = g.id
  h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id, name: 'O', email: 'o@o' } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('labor bulk-import — borne anti-DoS (V15 P2)', () => {
  it('> 500 opérations → 400, rien inséré', async () => {
    const operations = Array.from({ length: 501 }, (_, i) => ({ name: `Op ${i}`, durationMin: 30, unitPrice: 10 }))
    const res = await bulkImport(jreq('POST', { operations }))
    expect(res.status).toBe(400)
    const count = await prisma.laborOperation.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(0)
  })
  it('lot raisonnable → 201', async () => {
    const operations = [{ name: 'Vidange', durationMin: 30, unitPrice: 40 }, { name: 'Freins', durationMin: 60, unitPrice: 90 }]
    const res = await bulkImport(jreq('POST', { operations }))
    expect(res.status).toBe(201)
    const count = await prisma.laborOperation.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(2)
  })
})

describe('appointment — transition atomique (V15 P2)', () => {
  it('confirm + cancel concurrents : exactement un 200, un 409', async () => {
    const appt = await prisma.appointment.create({
      data: { garageId: ctx.garageId, clientName: 'C', reason: 'R', date: '2026-08-10', startTime: '09:00', status: 'requested' },
    })
    const [a, b] = await Promise.all([
      apptAction(jreq('POST', { action: 'confirm' }), { params: { id: appt.id } }),
      apptAction(jreq('POST', { action: 'cancel' }), { params: { id: appt.id } }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409]) // une seule action l'emporte
    const fresh = await prisma.appointment.findUnique({ where: { id: appt.id } })
    // Le statut final est l'un des deux terminaux atteints par le gagnant, jamais un mélange.
    expect(['confirmed', 'cancelled']).toContain(fresh.status)
  })
})

describe('mechanics — dé-doublonnage réel (V15 P2)', () => {
  it('même nom (casse différente) → 409 ; nom distinct → 201', async () => {
    const first = await mechPost(jreq('POST', { name: 'Jean', color: '#3b82f6', specialty: [] }))
    expect(first.status).toBe(201)
    const dup = await mechPost(jreq('POST', { name: '  jean ', color: '#ef4444', specialty: [] }))
    expect(dup.status).toBe(409)
    const other = await mechPost(jreq('POST', { name: 'Marie', color: '#10b981', specialty: [] }))
    expect(other.status).toBe(201)
    const count = await prisma.mechanic.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(2) // Jean + Marie, pas de doublon
  })
})

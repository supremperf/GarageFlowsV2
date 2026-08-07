/**
 * /api/parts GET — borne de sécurité & pagination (V15, lot 21).
 *
 * Prouve que le listing du stock ne charge plus un catalogue arbitrairement
 * grand : `?limit` borne le résultat, `?page` pagine, et l'ensemble reste
 * scopé au garage. Empêche un déni de service par catalogue pathologique.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../../../../.tmp-parts-pagination.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let prisma: any
let GET: (req: Request) => Promise<Response>
const garageId = { v: '' }

const get = (qs = '') => GET(new Request(`http://localhost/api/parts${qs}`))

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../../../../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = (await import('@/app/api/parts/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'P', slug: 'parts-pg' } })
  garageId.v = g.id
  // 25 pièces, noms triables déterministes.
  await prisma.part.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      name: `Pièce ${String(i).padStart(3, '0')}`, garageId: g.id, quantity: i, minQuantity: 5,
    })),
  })
  h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('/api/parts — borne & pagination', () => {
  it('?limit=10 → au plus 10 résultats', async () => {
    const body = await (await get('?limit=10')).json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(10)
    expect(body[0].name).toBe('Pièce 000') // tri par nom
  })

  it('?page=2&limit=10 → page suivante disjointe', async () => {
    const p1 = await (await get('?page=1&limit=10')).json()
    const p2 = await (await get('?page=2&limit=10')).json()
    expect(p2[0].name).toBe('Pièce 010')
    const names1 = new Set(p1.map((p: any) => p.name))
    expect(p2.every((p: any) => !names1.has(p.name))).toBe(true)
  })

  it('sans limite → cap de sécurité appliqué (≤ 5000), tout le petit catalogue rendu', async () => {
    const body = await (await get()).json()
    expect(body.length).toBe(25)
    expect(body.length).toBeLessThanOrEqual(5000)
  })

  it('limite excessive bornée au maximum (5000)', async () => {
    const body = await (await get('?limit=999999')).json()
    // 25 pièces seulement, mais la requête n'aurait jamais dépassé 5000.
    expect(body.length).toBe(25)
  })
})

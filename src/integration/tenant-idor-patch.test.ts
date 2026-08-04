/**
 * Integration test — IDOR de 2nd ordre sur les PATCH de véhicules et de jobs.
 *
 * Exécute les VRAIS handlers de route contre une base SQLite temporaire réelle,
 * seule la couche d'auth étant simulée (session = garage A). Prouve qu'un client
 * de PATCH ne peut pas rattacher une ressource d'un AUTRE garage :
 *   • vehicles/[id] PATCH avec clientId d'un autre garage → refusé (pas de fuite
 *     du client étranger via l'include GET) ;
 *   • jobs/[id] PATCH avec mechanicId d'un autre garage → refusé.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-idor.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let vehiclePATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let jobPATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let prisma: any

const ids = { garageA: '', garageB: '', clientA: '', clientB: '', vehicleA: '', mechA: '', mechB: '', jobA: '' }

function patch(handler: any, id: string, body: unknown) {
  const req = new Request(`http://localhost/api/x/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return handler(req, { params: { id } }).then(async (res: Response) => ({ status: res.status, json: await res.json() }))
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` },
    stdio: 'ignore',
  })

  ;({ prisma } = await import('@/lib/db'))
  ;({ PATCH: vehiclePATCH } = await import('@/app/api/vehicles/[id]/route') as any)
  ;({ PATCH: jobPATCH } = await import('@/app/api/jobs/[id]/route') as any)

  const a = await prisma.garage.create({ data: { name: 'A', slug: 'a' } })
  const b = await prisma.garage.create({ data: { name: 'B', slug: 'b' } })
  ids.garageA = a.id; ids.garageB = b.id

  const ca = await prisma.client.create({ data: { name: 'Client A', garageId: a.id } })
  const cb = await prisma.client.create({ data: { name: 'Client B (secret)', garageId: b.id } })
  ids.clientA = ca.id; ids.clientB = cb.id

  const va = await prisma.vehicle.create({ data: { licensePlate: 'AA-123-BB', make: 'Renault', model: 'Clio', garageId: a.id, clientId: ca.id } })
  ids.vehicleA = va.id

  const ma = await prisma.mechanic.create({ data: { name: 'Mech A', avatar: '', color: '#000', garageId: a.id } })
  const mb = await prisma.mechanic.create({ data: { name: 'Mech B', avatar: '', color: '#111', garageId: b.id } })
  ids.mechA = ma.id; ids.mechB = mb.id

  const ja = await prisma.job.create({ data: {
    customerName: 'X', vehicleModel: 'Y', repairType: 'Z', estimatedDuration: 60,
    startTime: '09:00', date: '2026-08-04', mechanicId: ma.id, garageId: a.id,
  } })
  ids.jobA = ja.id

  h.session = { user: { id: 'user-a', name: 'Alice', role: 'OWNER', garageId: a.id } }
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('IDOR 2nd ordre — vehicles/[id] PATCH', () => {
  it('REFUSE de rattacher le véhicule à un client d\'un autre garage', async () => {
    const { status } = await patch(vehiclePATCH, ids.vehicleA, { clientId: ids.clientB })
    expect(status).toBe(400)
    // Le véhicule n'a PAS été réassigné → aucune fuite du client étranger.
    const v = await prisma.vehicle.findUnique({ where: { id: ids.vehicleA } })
    expect(v.clientId).toBe(ids.clientA)
  })

  it('ACCEPTE un client du même garage', async () => {
    const { status } = await patch(vehiclePATCH, ids.vehicleA, { clientId: ids.clientA })
    expect(status).toBe(200)
  })
})

describe('IDOR 2nd ordre — jobs/[id] PATCH', () => {
  it('REFUSE d\'assigner un mécanicien d\'un autre garage', async () => {
    // Le handler jobs/[id] PATCH rejette via findFirst(garageId) → 404.
    const { status } = await patch(jobPATCH, ids.jobA, { mechanicId: ids.mechB })
    expect(status).toBe(404)
    const j = await prisma.job.findUnique({ where: { id: ids.jobA } })
    expect(j.mechanicId).toBe(ids.mechA) // inchangé
  })

  it('ACCEPTE un mécanicien du même garage', async () => {
    const { status } = await patch(jobPATCH, ids.jobA, { mechanicId: ids.mechA })
    expect(status).toBe(200)
  })
})

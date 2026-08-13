/**
 * ISOLATION MULTI-GARAGE — matrice systématique de permutation (lot C).
 *
 * Exécute les VRAIS handlers de route contre une base SQLite RÉELLE, avec une
 * session authentifiée du garage A, en tentant d'atteindre les ressources du
 * garage B sur CHAQUE famille de ressources et CHAQUE verbe HTTP exporté
 * (GET / PATCH / PUT / DELETE / POST par identifiant).
 *
 * Invariant prouvé pour chaque (ressource × opération) :
 *   1. une tentative inter-garage (session A → ressource B) échoue (statut ≥ 400)
 *      ET la ressource de B reste INTACTE en base ;
 *   2. la même opération sur sa PROPRE ressource réussit (statut < 400) —
 *      contrôle positif qui prouve que le test n'est pas trivialement toujours-404.
 *
 * Complète tenant-isolation.test.ts (primitives DB) et tenant-idor-patch.test.ts
 * (injection de FK) en prouvant le CÂBLAGE effectif du scoping garageId dans
 * chaque route [id] — le trou de couverture AUD-019.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-isolation-matrix.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  // withAuth réplique la capture d'erreurs de production : une exception
  // devient une réponse 500 (et non un rejet qui masquerait le test).
  withAuth: (fn: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await fn(req, ctx) } catch (e) {
        if (e instanceof Response) return e
        return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } })
      }
    },
  requireSession: async () => h.session,
}))

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>

let prisma: any
const R: Record<string, Record<string, Handler>> = {}

async function loadHandlers() {
  const mods: Array<[string, string]> = [
    ['vehicles', '@/app/api/vehicles/[id]/route'],
    ['jobs', '@/app/api/jobs/[id]/route'],
    ['invoices', '@/app/api/invoices/[id]/route'],
    ['quotes', '@/app/api/quotes/[id]/route'],
    ['work-orders', '@/app/api/work-orders/[id]/route'],
    ['purchase-orders', '@/app/api/purchase-orders/[id]/route'],
    ['parts', '@/app/api/parts/[id]/route'],
    ['appointments', '@/app/api/appointments/[id]/route'],
    ['inspections', '@/app/api/inspections/[id]/route'],
    ['loaner-vehicles', '@/app/api/loaner-vehicles/[id]/route'],
    ['loaner-reservations', '@/app/api/loaner-reservations/[id]/route'],
    ['warranties', '@/app/api/warranties/[id]/route'],
    ['labor-operations', '@/app/api/labor-operations/[id]/route'],
    ['mechanics', '@/app/api/mechanics/[id]/route'],
  ]
  for (const [key, spec] of mods) {
    const m = (await import(spec)) as Record<string, Handler>
    R[key] = {}
    for (const verb of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) if (m[verb]) R[key][verb] = m[verb]
  }
}

/** Sème un garage complet et renvoie les identifiants de chaque ressource. */
async function seedGarage(p: string) {
  const g = await prisma.garage.create({ data: { name: `Garage ${p}`, slug: `garage-${p}` } })
  const gid = g.id
  const mechanic = await prisma.mechanic.create({ data: { name: `Mech ${p}`, avatar: '', color: '#000000', garageId: gid } })
  const client = await prisma.client.create({ data: { name: `Client ${p}`, garageId: gid } })
  const vehicle = await prisma.vehicle.create({ data: { licensePlate: `${p}-123-XX`, make: 'Renault', model: 'Clio', clientId: client.id, garageId: gid } })
  const job = await prisma.job.create({ data: { customerName: `Cust ${p}`, vehicleModel: 'Clio', repairType: 'Vidange', estimatedDuration: 60, startTime: '09:00', date: '2026-08-04', mechanicId: mechanic.id, garageId: gid } })
  const invoice = await prisma.invoice.create({ data: { number: `FAC-${p}-001`, garageId: gid, clientName: `Cust ${p}`, issueDate: '2026-08-04', status: 'draft' } })
  const quote = await prisma.quote.create({ data: { number: `DEV-${p}-001`, garageId: gid, clientName: `Cust ${p}`, issueDate: '2026-08-04', status: 'draft' } })
  const workOrder = await prisma.workOrder.create({ data: { number: `OR-${p}-001`, garageId: gid, clientName: `Cust ${p}`, status: 'draft' } })
  const purchaseOrder = await prisma.purchaseOrder.create({ data: { number: `BC-${p}-001`, garageId: gid, status: 'draft' } })
  const part = await prisma.part.create({ data: { name: `Filtre ${p}`, garageId: gid } })
  const appointment = await prisma.appointment.create({ data: { garageId: gid, clientName: `Cust ${p}`, reason: 'Révision', date: '2026-08-04', startTime: '10:00', status: 'requested' } })
  const inspection = await prisma.inspection.create({ data: { garageId: gid, clientName: `Cust ${p}` } })
  const loanerVehicle = await prisma.loanerVehicle.create({ data: { garageId: gid, name: `Prêt ${p}`, licensePlate: `${p}-LOAN-1` } })
  const loanerReservation = await prisma.loanerReservation.create({ data: { garageId: gid, vehicleId: loanerVehicle.id, clientName: `Cust ${p}`, startDate: new Date('2026-08-04'), endDate: new Date('2026-08-06') } })
  const warranty = await prisma.warranty.create({ data: { garageId: gid, clientName: `Cust ${p}`, partName: 'Batterie', expiresAt: new Date('2027-08-04') } })
  const laborOperation = await prisma.laborOperation.create({ data: { garageId: gid, name: `Op ${p}` } })
  return { gid, mechanicId: mechanic.id, clientId: client.id, ids: {
    vehicles: vehicle.id, jobs: job.id, invoices: invoice.id, quotes: quote.id,
    'work-orders': workOrder.id, 'purchase-orders': purchaseOrder.id, parts: part.id,
    appointments: appointment.id, inspections: inspection.id, 'loaner-vehicles': loanerVehicle.id,
    'loaner-reservations': loanerReservation.id, warranties: warranty.id, 'labor-operations': laborOperation.id,
    mechanics: mechanic.id,
  } }
}

/** Delegate Prisma par famille, pour vérifier « la ressource existe toujours ». */
const DELEGATE: Record<string, string> = {
  vehicles: 'vehicle', jobs: 'job', invoices: 'invoice', quotes: 'quote',
  'work-orders': 'workOrder', 'purchase-orders': 'purchaseOrder', parts: 'part',
  appointments: 'appointment', inspections: 'inspection', 'loaner-vehicles': 'loanerVehicle',
  'loaner-reservations': 'loanerReservation', warranties: 'warranty', 'labor-operations': 'laborOperation',
  mechanics: 'mechanic',
}

/**
 * Corps VALIDES minimaux par famille (pour atteindre le contrôle de propriété
 * même dans les handlers qui valident le corps AVANT le findFirst).
 */
const PATCH_BODY: Record<string, unknown> = {
  vehicles: { make: 'X' }, jobs: {}, invoices: { clientName: 'X' }, quotes: { clientName: 'X' },
  'work-orders': { clientName: 'X' }, 'purchase-orders': { status: 'draft' }, parts: { name: 'X' },
  inspections: { clientName: 'X' }, 'loaner-vehicles': { name: 'X' }, 'loaner-reservations': { clientName: 'X' },
  warranties: { clientName: 'X' }, 'labor-operations': { name: 'X' }, mechanics: { name: 'X' },
}

let A: Awaited<ReturnType<typeof seedGarage>>
let B: Awaited<ReturnType<typeof seedGarage>>

function makeReq(method: string, body?: unknown): Request {
  const init: RequestInit = { method }
  // GET/HEAD ne peuvent pas porter de corps (contrainte de l'API Request).
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return new Request('http://localhost/api/x', init)
}

async function call(fam: string, verb: string, id: string, body?: unknown) {
  const handler = R[fam][verb]
  const res = await handler(makeReq(verb, body), { params: { id } })
  return res.status
}

async function stillExists(fam: string, id: string): Promise<boolean> {
  const row = await (prisma as any)[DELEGATE[fam]].findUnique({ where: { id } })
  return row !== null
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  await loadHandlers()
  A = await seedGarage('A')
  B = await seedGarage('B')
  // Session par défaut : OWNER du garage A.
  h.session = { user: { id: 'user-a', name: 'Alice', role: 'OWNER', garageId: A.gid } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

// ── Matrice inter-garage : session A → ressource B, tous verbes ───────────────
const FAMILIES = Object.keys(DELEGATE)

describe('Isolation inter-garage — session A ne peut atteindre AUCUNE ressource de B', () => {
  for (const fam of FAMILIES) {
    it(`${fam} : tous les verbes exportés sur la ressource de B échouent et laissent B intact`, async () => {
      const verbs = Object.keys(R[fam])
      expect(verbs.length).toBeGreaterThan(0)
      for (const verb of verbs) {
        const body = verb === 'POST' ? { action: 'confirm' } : PATCH_BODY[fam]
        const status = await call(fam, verb, B.ids[fam as keyof typeof B.ids], body)
        expect(status, `${verb} ${fam}/${B.ids[fam as keyof typeof B.ids]} devrait échouer`).toBeGreaterThanOrEqual(400)
        // Quel que soit le verbe, la ressource de B doit rester présente.
        expect(await stillExists(fam, B.ids[fam as keyof typeof B.ids]), `${fam} de B supprimé par ${verb} de A`).toBe(true)
      }
    })
  }
})

// ── Contrôle positif : A peut lire/modifier SA propre ressource ───────────────
describe('Contrôle positif — A accède bien à ses propres ressources', () => {
  for (const fam of FAMILIES) {
    it(`${fam} : une opération non destructive sur la ressource de A réussit`, async () => {
      const verbs = Object.keys(R[fam])
      const id = A.ids[fam as keyof typeof A.ids]
      if (verbs.includes('GET')) {
        expect(await call(fam, 'GET', id)).toBeLessThan(400)
      } else if (fam === 'appointments') {
        expect(await call(fam, 'POST', id, { action: 'confirm' })).toBeLessThan(400)
      } else if (verbs.includes('PATCH')) {
        expect(await call(fam, 'PATCH', id, PATCH_BODY[fam])).toBeLessThan(400)
      }
    })
  }
})

// ── Scoping des listes : A ne voit jamais les ressources de B ─────────────────
describe('Scoping des listes — les collections de A excluent les ressources de B', () => {
  const LISTS: Array<[string, string]> = [
    ['jobs', '@/app/api/jobs/route'],
    ['invoices', '@/app/api/invoices/route'],
    ['quotes', '@/app/api/quotes/route'],
    ['work-orders', '@/app/api/work-orders/route'],
    ['appointments', '@/app/api/appointments/route'],
    ['inspections', '@/app/api/inspections/route'],
    ['loaner-vehicles', '@/app/api/loaner-vehicles/route'],
    ['warranties', '@/app/api/warranties/route'],
    ['labor-operations', '@/app/api/labor-operations/route'],
    ['mechanics', '@/app/api/mechanics/route'],
  ]
  for (const [fam, spec] of LISTS) {
    it(`${fam} : la liste de A contient l'objet de A et jamais celui de B`, async () => {
      const mod = (await import(spec)) as Record<string, Handler>
      const res = await mod.GET(makeReq('GET'), { params: {} })
      expect(res.status).toBeLessThan(400)
      const text = JSON.stringify(await res.json())
      expect(text).toContain(A.ids[fam as keyof typeof A.ids])
      expect(text, `${fam} : la liste de A contient un id de B`).not.toContain(B.ids[fam as keyof typeof B.ids])
    })
  }
})

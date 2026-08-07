/**
 * Intégrité des documents — corrections V15 (base SQLite réelle).
 *
 * 1. OR signé NON re-signable : une seconde signature est refusée (409) et la
 *    signature scellée d'origine est préservée. Sceau atomique (updateMany
 *    conditionnel signedAt=null) → deux requêtes concurrentes ne peuvent pas
 *    sceller deux signatures.
 * 2. Facture émise : le verrou d'immutabilité tient à travers le nouveau chemin
 *    (re-contrôle DANS la transaction) — édition financière refusée (409),
 *    lignes inchangées.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-doc-integrity-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let signWO: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let patchInvoice: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garageId: '', woId: '', invoiceId: '' }

const jreq = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: signWO } = (await import('@/app/api/work-orders/[id]/sign/route')) as any)
  ;({ PATCH: patchInvoice } = (await import('@/app/api/invoices/[id]/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'DI', slug: 'doc-int-v15' } })
  const mech = await prisma.mechanic.create({ data: { name: 'M', avatar: '', color: '#000', garageId: g.id } })
  const job = await prisma.job.create({ data: { customerName: 'C', vehicleModel: 'V', repairType: 'R', estimatedDuration: 60, startTime: '09:00', date: '2026-08-07', mechanicId: mech.id, garageId: g.id } })
  const wo = await prisma.workOrder.create({ data: { number: 'OR-1', jobId: job.id, mechanicId: mech.id, garageId: g.id, clientName: 'C', status: 'draft' } })
  const inv = await prisma.invoice.create({ data: { number: 'FAC-1', garageId: g.id, clientName: 'C', status: 'draft', issueDate: '2026-08-07', taxRate: 20, lines: { create: [{ description: 'L', quantityTenThousandths: 10000, unitPriceTenThousandths: 100000, sortOrder: 0 }] } } })
  ids.garageId = g.id; ids.woId = wo.id; ids.invoiceId = inv.id
  h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('OR signé — non re-signable (V15 P0)', () => {
  it('1re signature → 200 ; 2e signature → 409 ; sceau d’origine préservé', async () => {
    const first = await signWO(jreq('POST', { signatureData: 'data:image/png;base64,AAAA' }), { params: { id: ids.woId } })
    expect(first.status).toBe(200)
    const sealed = await prisma.workOrder.findUnique({ where: { id: ids.woId } })
    expect(sealed.signedAt).not.toBeNull()
    const firstSig = sealed.signatureData

    const second = await signWO(jreq('POST', { signatureData: 'data:image/png;base64,BBBB' }), { params: { id: ids.woId } })
    expect(second.status).toBe(409)
    const after = await prisma.workOrder.findUnique({ where: { id: ids.woId } })
    expect(after.signatureData).toBe(firstSig)      // signature NON écrasée
    expect(after.signedAt.getTime()).toBe(sealed.signedAt.getTime())
  })

  it('signature concurrente : une seule scelle (updateMany conditionnel atomique)', async () => {
    const mech = await prisma.mechanic.findFirst({ where: { garageId: ids.garageId } })
    const job2 = await prisma.job.create({ data: { customerName: 'C2', vehicleModel: 'V', repairType: 'R', estimatedDuration: 60, startTime: '10:00', date: '2026-08-07', mechanicId: mech.id, garageId: ids.garageId } })
    const wo2 = await prisma.workOrder.create({ data: { number: 'OR-2', jobId: job2.id, mechanicId: mech.id, garageId: ids.garageId, clientName: 'C', status: 'draft' } })
    const [a, b] = await Promise.all([
      signWO(jreq('POST', { signatureData: 'data:image/png;base64,AAAA' }), { params: { id: wo2.id } }),
      signWO(jreq('POST', { signatureData: 'data:image/png;base64,BBBB' }), { params: { id: wo2.id } }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])   // exactement une réussite
  })
})

describe('Facture émise — verrou tient via le re-contrôle en transaction (V15 P1)', () => {
  it('facture « sent » : édition financière refusée (409), lignes inchangées', async () => {
    await prisma.invoice.update({ where: { id: ids.invoiceId }, data: { status: 'sent' } })
    const before = await prisma.invoiceLine.count({ where: { invoiceId: ids.invoiceId } })
    const res = await patchInvoice(jreq('PATCH', { lines: [{ description: 'HACK', quantity: 99, unitPrice: 999 }] }), { params: { id: ids.invoiceId } })
    expect(res.status).toBe(409)
    const after = await prisma.invoiceLine.findMany({ where: { invoiceId: ids.invoiceId } })
    expect(after.length).toBe(before)
    expect(after[0].description).toBe('L')  // ligne d'origine préservée
  })
})

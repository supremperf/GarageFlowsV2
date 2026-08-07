/**
 * Mass-assignment de statut — corrections V15 (base SQLite réelle).
 *
 * Bon de commande fournisseur :
 *  - la réception (POST /receive) incrémente le stock UNE fois ; le PATCH générique
 *    ne peut plus rétrograder un BC réceptionné (« received » terminal) → pas de
 *    ré-inflation du stock, pas de contournement du verrou de suppression ;
 *  - « received » n'est PAS atteignable via le PATCH générique (réception = /receive).
 *
 * Garantie :
 *  - « claimed » est terminal : impossible de dé-réclamer via PATCH puis de
 *    supprimer une garantie réclamée.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-status-massassign-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let serializePoLinesJsonV2: (lines: any[]) => string
let poPatch: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let poDelete: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let poReceive: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let wPatch: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let wDelete: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ctx = { garageId: '', partId: '' }

const jreq = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ serializePoLinesJsonV2 } = await import('@/lib/money-json'))
  ;({ PATCH: poPatch, DELETE: poDelete } = (await import('@/app/api/purchase-orders/[id]/route')) as any)
  ;({ POST: poReceive } = (await import('@/app/api/purchase-orders/[id]/receive/route')) as any)
  ;({ PATCH: wPatch, DELETE: wDelete } = (await import('@/app/api/warranties/[id]/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'MA', slug: 'massassign-v15' } })
  ctx.garageId = g.id
  const part = await prisma.part.create({ data: { name: 'Filtre', garageId: g.id, quantity: 0 } })
  ctx.partId = part.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

async function makePO(number: string, qty: number) {
  const linesJson = serializePoLinesJsonV2([
    { partId: ctx.partId, partName: 'Filtre', qtyTenThousandths: qty * 10000, unitCostTenThousandths: 0, lineTotalCents: 0 },
  ])
  return prisma.purchaseOrder.create({ data: { number, garageId: ctx.garageId, status: 'draft', linesJson } })
}

describe('Bon de commande — anti ré-inflation du stock (V15 P2)', () => {
  it('réception unique puis rétrogradation refusée → stock non ré-incrémenté', async () => {
    h.session = { user: { id: 'u', role: 'OWNER', garageId: ctx.garageId } }
    const po = await makePO('BC-1', 5)

    // 1re réception : stock 0 → 5, BC « received ».
    const r1 = await poReceive(jreq('POST'), { params: { id: po.id } })
    expect(r1.status).toBe(200)
    let part = await prisma.part.findUnique({ where: { id: ctx.partId } })
    expect(part.quantity).toBe(5)

    // Tentative de rétrogradation « received » → « draft » : REFUSÉE (terminal).
    const down = await poPatch(jreq('PATCH', { status: 'draft' }), { params: { id: po.id } })
    expect(down.status).toBe(409)
    const stillReceived = await prisma.purchaseOrder.findUnique({ where: { id: po.id } })
    expect(stillReceived.status).toBe('received')

    // 2e réception impossible (déjà réceptionné) → stock inchangé (pas de ré-inflation).
    const r2 = await poReceive(jreq('POST'), { params: { id: po.id } })
    expect(r2.status).toBe(409)
    part = await prisma.part.findUnique({ where: { id: ctx.partId } })
    expect(part.quantity).toBe(5) // toujours 5, jamais 10

    // Un BC réceptionné n'est pas supprimable (verrou intact).
    const del = await poDelete(jreq('DELETE'), { params: { id: po.id } })
    expect(del.status).toBe(400)
  })

  it('« received » n’est pas atteignable via le PATCH générique (réception = /receive)', async () => {
    h.session = { user: { id: 'u', role: 'OWNER', garageId: ctx.garageId } }
    const po = await makePO('BC-2', 3)
    const res = await poPatch(jreq('PATCH', { status: 'received' }), { params: { id: po.id } })
    expect(res.status).toBe(409)
    const fresh = await prisma.purchaseOrder.findUnique({ where: { id: po.id } })
    expect(fresh.status).toBe('draft')          // inchangé
    const part = await prisma.part.findUnique({ where: { id: ctx.partId } })
    expect(part.quantity).toBe(5)               // aucun stock ajouté
  })
})

describe('Garantie — « claimed » terminal (V15 P2)', () => {
  it('impossible de dé-réclamer via PATCH puis de supprimer une garantie réclamée', async () => {
    h.session = { user: { id: 'u', role: 'OWNER', garageId: ctx.garageId } }
    const w = await prisma.warranty.create({
      data: { garageId: ctx.garageId, clientName: 'C', partName: 'Disque', status: 'active', expiresAt: new Date('2027-01-01') },
    })

    // Réclamation légitime.
    const claim = await wPatch(jreq('PATCH', { status: 'claimed' }), { params: { id: w.id } })
    expect(claim.status).toBe(200)
    const claimed = await prisma.warranty.findUnique({ where: { id: w.id } })
    expect(claimed.status).toBe('claimed')
    expect(claimed.claimedAt).not.toBeNull()

    // Dé-réclamation refusée (terminal).
    const revert = await wPatch(jreq('PATCH', { status: 'active' }), { params: { id: w.id } })
    expect(revert.status).toBe(409)

    // Suppression refusée (garantie réclamée).
    const del = await wDelete(jreq('DELETE'), { params: { id: w.id } })
    expect(del.status).toBe(400)
    const stillThere = await prisma.warranty.findUnique({ where: { id: w.id } })
    expect(stillThere).not.toBeNull()
  })
})

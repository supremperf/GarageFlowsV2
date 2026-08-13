/**
 * API-route integration test for /api/suppliers.
 *
 * Real handler over a temporary SQLite DB, auth mocked. Verifies the reorder
 * plan (grouped by supplier, tenant-scoped), confirmation-gated order creation,
 * and the guarded lifecycle state machine with its atomic stock effects.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-suppliers.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let GET: (req: Request) => Promise<Response>
let POST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
const ids: Record<string, string> = {}

async function get(qs = ''): Promise<{ status: number; json: any }> {
  const res = await GET(new Request(`http://localhost/api/suppliers${qs}`))
  return { status: res.status, json: await res.json() }
}
async function post(body: unknown): Promise<{ status: number; json: any }> {
  const res = await POST(new Request('http://localhost/api/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET, POST } = await import('@/app/api/suppliers/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id

  const mkPart = async (d: any) => (await prisma.part.create({ data: { garageId: garageA, ...d } })).id
  ids.p1 = await mkPart({ name: 'Plaquettes avant', quantity: 2, minQuantity: 5, unitCostTenThousandths: 200000, unitPriceTenThousandths: 400000, supplierName: 'Oscaro', supplierRef: 'OSC-BRK-01' })
  ids.p2 = await mkPart({ name: 'Disques avant', quantity: 5, minQuantity: 5, unitCostTenThousandths: 450000, unitPriceTenThousandths: 900000, supplierName: 'Oscaro', supplierRef: 'OSC-DSC-01' }) // qty==min → included
  ids.p3 = await mkPart({ name: 'Filtre a huile', quantity: 1, minQuantity: 4, unitCostTenThousandths: 80000, unitPriceTenThousandths: 160000, supplierName: 'MisterAuto', supplierRef: 'MA-OIL-09' })
  ids.p4 = await mkPart({ name: 'Essuie-glace', quantity: 20, minQuantity: 6, unitCostTenThousandths: 60000, unitPriceTenThousandths: 120000, supplierName: 'MisterAuto' }) // NOT low → excluded
  ids.p5 = await mkPart({ name: 'Courroie', quantity: 20, minQuantity: 3, unitCostTenThousandths: 500000, unitPriceTenThousandths: 1200000, supplierName: 'Oscaro' }) // control for receive
  ids.pRace = await mkPart({ name: 'Amortisseur', quantity: 10, minQuantity: 3, unitCostTenThousandths: 600000, unitPriceTenThousandths: 1300000, supplierName: 'Oscaro' }) // control for the concurrency test

  await prisma.part.create({ data: { garageId: garageB, name: 'Bougie', quantity: 0, minQuantity: 4, unitCostTenThousandths: 30000, unitPriceTenThousandths: 60000, supplierName: 'MisterAuto' } })

  const mkPO = async (d: any) => (await prisma.purchaseOrder.create({ data: d })).id
  ids.poSend = await mkPO({ number: 'BC-2026-901', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHtCents: 16000, linesJson: JSON.stringify([{ partId: ids.p1, partName: 'Plaquettes avant', qty: 8, unitCost: 20 }]) })
  ids.poRecv = await mkPO({ number: 'BC-2026-902', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHtCents: 40000, linesJson: JSON.stringify([{ partId: ids.p5, partName: 'Courroie', qty: 8, unitCost: 50 }]) })
  ids.poIllegal = await mkPO({ number: 'BC-2026-903', garageId: garageA, supplierName: 'Oscaro', status: 'draft', totalHtCents: 40000, linesJson: '[]' })
  ids.poB = await mkPO({ number: 'BC-2026-001', garageId: garageB, supplierName: 'Oscaro', status: 'draft', totalHtCents: 900, linesJson: '[]' })
  ids.poRace = await mkPO({ number: 'BC-2026-905', garageId: garageA, supplierName: 'Oscaro', status: 'sent', sentAt: new Date(), totalHtCents: 30000, linesJson: JSON.stringify([{ partId: ids.pRace, partName: 'Amortisseur', qty: 5, unitCost: 60 }]) })

  // Un rôle RÉEL : en production, la session NextAuth en porte toujours un, et
  // les écritures de stock exigent `stock:manage` (GF31-AUD-029). Une session
  // sans rôle — ce que construisait cette fixture — n'existe pas en production
  // et se fait légitimement refuser par le refus-par-défaut de `can()`.
  h.session = { user: { id: 'user-a', name: 'Alice', role: 'OWNER', garageId: garageA } }
})

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

describe('GET /api/suppliers (reorder plan)', () => {
  it('groups low-stock parts by supplier, tenant-scoped, excluding well-stocked parts', async () => {
    const { status, json } = await get()
    expect(status).toBe(200)
    expect(json.scope).toEqual({ targetMultiplier: 2, lowStockParts: 3 })
    expect(json.orders.map((o: any) => o.supplierName)).toEqual(['MisterAuto', 'Oscaro'])
    const allPartIds = json.orders.flatMap((o: any) => o.lines.map((l: any) => l.partId))
    expect(allPartIds).toContain(ids.p1)
    expect(allPartIds).toContain(ids.p2) // qty == minQuantity is included
    expect(allPartIds).not.toContain(ids.p4) // well-stocked excluded
    expect(allPartIds).not.toContain(ids.p5)
    // Garage B's low part never leaks
    expect(json.orders.flatMap((o: any) => o.lines.map((l: any) => l.name))).not.toContain('Bougie')
  })
})

describe('POST create-orders (confirmation-gated)', () => {
  it('previews without persisting any purchase order', async () => {
    const before = await prisma.purchaseOrder.count({ where: { garageId: garageA } })
    const { json } = await post({ action: 'create-orders' })
    expect(json.confirmationRequired).toBe(true)
    expect(json.preview.orders.length).toBe(2)
    expect(await prisma.purchaseOrder.count({ where: { garageId: garageA } })).toBe(before)
  })

  it('persists one draft PO per supplier when confirmed', async () => {
    const { status, json } = await post({ action: 'create-orders', confirm: true })
    expect(status).toBe(201)
    expect(json.created.length).toBe(2)
    for (const c of json.created) {
      const po = await prisma.purchaseOrder.findFirst({ where: { id: c.id } })
      expect(po.status).toBe('draft')
      expect(po.garageId).toBe(garageA)
    }
  })

  it('rejects a targeted order for a foreign part with 400', async () => {
    const foreign = await prisma.part.findFirst({ where: { garageId: garageB } })
    const { status } = await post({ action: 'create-orders', confirm: true, parts: [{ partId: foreign.id, quantity: 3 }] })
    expect(status).toBe(400)
  })
})

describe('POST transition (guarded lifecycle + stock effects)', () => {
  it('previews a transition without writing', async () => {
    const { json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent' })
    expect(json.confirmationRequired).toBe(true)
    expect(json.effects.stampSent).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('draft') // unchanged
  })

  it('confirms draft→sent and stamps sentAt without touching stock', async () => {
    const stockBefore = (await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity // p1 is on poSend
    const { status, json } = await post({ action: 'transition', orderId: ids.poSend, to: 'sent', confirm: true })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    const po = await prisma.purchaseOrder.findFirst({ where: { id: ids.poSend } })
    expect(po.status).toBe('sent')
    expect(po.sentAt).not.toBeNull()
    // Negative control: sending must NOT add stock (only receipt does).
    expect((await prisma.part.findFirst({ where: { id: ids.p1 } })).quantity).toBe(stockBefore)
  })

  it('confirms →received and atomically increments part stock, once', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity // 20
    const { status } = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(status).toBe(200)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8) // 28

    // Re-receiving is a rejected no-op → no double increment.
    const again = await post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true })
    expect(again.status).toBe(400)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(before + 8)
  })

  it('serialises two concurrent receipts: exactly one applies, stock incremented once', async () => {
    const before = (await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity // 10
    const [r1, r2] = await Promise.all([
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
      post({ action: 'transition', orderId: ids.poRace, to: 'received', confirm: true }),
    ])
    const statuses = [r1.status, r2.status].sort()

    // Exactly one receipt applies. The loser is refused, but WHICH refusal
    // depends on the interleaving — both are correct:
    //   409 — it read 'sent' too, then the compare-and-swap
    //         (updateMany where status='sent') matched no row.
    //   400 — it read AFTER the winner committed, so it saw 'received' and the
    //         state machine rejected the illegal received→received transition.
    // The previous assertion demanded 409 specifically and therefore failed on
    // every isolated run (measured 4/4), passing only when full-suite timing
    // happened to produce the read-read interleaving. The guarantee under test
    // is "no double receipt", not which of the two refusals is returned.
    expect(statuses[0]).toBe(200)
    expect([400, 409]).toContain(statuses[1])

    // THE invariant that matters: stock incremented exactly once, never twice.
    expect((await prisma.part.findFirst({ where: { id: ids.pRace } })).quantity).toBe(before + 5)
    // And the order settles on the single terminal state.
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poRace } })).status).toBe('received')
  })

  it('rejects an illegal transition (draft→received) even with confirm', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poIllegal, to: 'received', confirm: true })
    expect(status).toBe(400)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poIllegal } })).status).toBe('draft')
  })

  it('returns 404 for an order belonging to another garage (tenant isolation)', async () => {
    const { status } = await post({ action: 'transition', orderId: ids.poB, to: 'sent', confirm: true })
    expect(status).toBe(404)
    expect((await prisma.purchaseOrder.findFirst({ where: { id: ids.poB } })).status).toBe('draft') // untouched
  })
})

/**
 * NON-RÉGRESSION GF31-AUD-002.
 *
 * Tous les cas de cycle de vie ci-dessus sont alimentés par des fixtures écrites
 * à la main au format V1 HISTORIQUE (tableau nu `[{ partId, qty, unitCost }]`).
 * Or `action: 'create-orders'` — le SEUL écrivain de production, appelé par
 * `SuppliersPanel` — persiste depuis `serializePoLinesJsonV2()`, c'est-à-dire un
 * OBJET `{ schemaVersion: 2, lines: [...] }` avec `qtyTenThousandths`.
 *
 * `action: 'transition'` faisait un `JSON.parse` nu puis `lines.filter(...)` :
 * sur un objet, `.filter` n'existe pas → TypeError non rattrapée → HTTP 500, et
 * le stock n'était JAMAIS incrémenté à la réception. La suite restait verte
 * uniquement parce qu'aucune fixture n'utilisait le format réellement écrit.
 *
 * Ce test refait le parcours COMPLET avec l'écrivain de production, sans aucune
 * fixture : créer → envoyer → réceptionner → vérifier le stock.
 */
describe('GF31-AUD-002 — cycle de vie sur une commande écrite par la production (V2)', () => {
  it('crée, envoie et réceptionne une commande issue de create-orders, et incrémente le stock', async () => {
    // Pièce sous le seuil : elle sera reprise dans le plan de réapprovisionnement.
    const partId = (await prisma.part.create({
      data: {
        garageId: garageA, name: 'Bobine allumage', quantity: 1, minQuantity: 6,
        unitCostTenThousandths: 350000, unitPriceTenThousandths: 700000,
        supplierName: 'AUD002-Fournisseur', supplierRef: 'AUD002-REF',
      },
    })).id

    // 1. Création par l'écrivain de PRODUCTION (format V2 réel).
    const create = await post({ action: 'create-orders', confirm: true, supplierName: 'AUD002-Fournisseur' })
    expect(create.status).toBe(201)
    const orderId: string = create.json.created[0].id

    // Le stockage est bien au format versionné V2 — c'est la prémisse du défaut.
    const stored = await prisma.purchaseOrder.findFirst({ where: { id: orderId } })
    const parsed = JSON.parse(stored.linesJson)
    expect(Array.isArray(parsed)).toBe(false)
    expect(parsed.schemaVersion).toBe(2)

    const before = (await prisma.part.findFirst({ where: { id: partId } })).quantity
    const ordered = parsed.lines[0].qtyTenThousandths / 10000
    expect(ordered).toBeGreaterThan(0)

    // 2. draft → sent : doit répondre 200 (et non 500).
    const sent = await post({ action: 'transition', orderId, to: 'sent', confirm: true })
    expect(sent.status).toBe(200)

    // 3. sent → received : doit répondre 200 ET incrémenter réellement le stock.
    const recv = await post({ action: 'transition', orderId, to: 'received', confirm: true })
    expect(recv.status).toBe(200)

    const after = (await prisma.part.findFirst({ where: { id: partId } })).quantity
    expect(after).toBe(before + ordered)
  })
})

/**
 * GF31-AUD-029 — la permission `stock:manage` n'était appliquée NULLE PART.
 *
 * Elle est déclarée dans la matrice (`authz.ts`) et réservée à MANAGER/OWNER,
 * mais `grep 'stock:manage' src/app` ne renvoyait aucun résultat : un
 * RECEPTIONIST créait des commandes fournisseur et déclenchait leur réception —
 * donc l'entrée en stock — alors que la matrice le lui refuse. C'est le même
 * défaut que sur les factures (GF31-AUD-009), sur le domaine voisin.
 */
describe('GF31-AUD-029 — `stock:manage` sur les écritures fournisseur', () => {
  const avec = async <T>(role: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const precedent = h.session
    h.session = { user: { id: 'u2', name: 'Bob', role, garageId: garageA } }
    try { return await fn() } finally { h.session = precedent }
  }

  it('RECEPTIONIST : lecture du plan de réapprovisionnement autorisée', async () => {
    const { status } = await avec('RECEPTIONIST', () => get())
    expect(status).toBe(200)
  })

  it.each(['RECEPTIONIST', 'MECHANIC', undefined])('%s : création de commandes refusée', async (role) => {
    const { status } = await avec(role, () => post({ action: 'create-orders', confirm: true }))
    expect(status).toBe(403)
  })

  it('RECEPTIONIST : transition de commande refusée (pas d’entrée en stock)', async () => {
    const avant = (await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity
    const { status } = await avec('RECEPTIONIST', () =>
      post({ action: 'transition', orderId: ids.poRecv, to: 'received', confirm: true }))
    expect(status).toBe(403)
    expect((await prisma.part.findFirst({ where: { id: ids.p5 } })).quantity).toBe(avant)
  })

  it.each(['OWNER', 'MANAGER'])('%s : conserve l’accès en écriture', async (role) => {
    const { status } = await avec(role, () => post({ action: 'create-orders', confirm: false }))
    // `confirm: false` renvoie l'aperçu (200) : la garde de rôle est franchie.
    expect(status).toBe(200)
  })
})

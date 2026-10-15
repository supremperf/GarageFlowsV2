/**
 * GF31-AUD-050 / 051 / 052 — trois montants ou quantités enregistrés autrement
 * que ce que l'opérateur a saisi.
 *
 * · 050 — import en masse du barème main-d'œuvre : `Number('abc')` vaut NaN, et
 *   toute comparaison avec NaN est FAUSSE. La garde `< 0` laissait donc passer
 *   n'importe quelle saisie non numérique, que `toScaled(NaN)` enregistrait
 *   ensuite à **0 €**. Tout un barème pouvait partir à zéro, l'API confirmant
 *   un succès.
 *
 * · 051 — réception d'un bon de commande : une quantité fractionnaire était
 *   arrondie à l'entier le plus proche, en silence, sur un statut TERMINAL et
 *   non rejouable. L'écart entre la quantité facturée par le fournisseur et le
 *   stock devenait permanent.
 *
 * · 052 — saisie d'un devis/facture : une quantité à 0 devenait 1. Vérifié ici
 *   à la source du composant, le contrôle vivant côté navigateur.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'
import { serializePoLinesJsonV2 } from '@/lib/money-json'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-stock-money-p3.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let bulkImport: (req: Request) => Promise<Response>
let receive: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: bulkImport } = (await import('@/app/api/labor-operations/bulk-import/route')) as any)
  ;({ POST: receive } = (await import('@/app/api/purchase-orders/[id]/receive/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'P3', slug: 'aud-p3-stock' } })).id
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.laborOperation.deleteMany({ where: { garageId } })
  await prisma.purchaseOrder.deleteMany({ where: { garageId } })
  await prisma.part.deleteMany({ where: { garageId } })
})

const importer = (operations: unknown[]) =>
  bulkImport(new Request('http://localhost/api/labor-operations/bulk-import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operations }),
  }))

describe('GF31-AUD-050 — import du barème : un prix illisible est refusé, pas mis à 0 €', () => {
  it.each([
    ['texte', 'quarante euros'],
    ['vide', ''],
    ['négatif', -5],
    ['notation exponentielle', '1e3'],
  ])('refuse un prix %s', async (_l, unitPrice) => {
    const res = await importer([{ name: 'Vidange', durationMin: 30, unitPrice }])
    expect(res.status).toBe(400)
    expect(await prisma.laborOperation.count({ where: { garageId } })).toBe(0)
  })

  it('refuse une durée non numérique', async () => {
    const res = await importer([{ name: 'Vidange', durationMin: 'trente', unitPrice: 45 }])
    expect(res.status).toBe(400)
  })

  it('un seul prix fautif annule TOUT l’import (rien à moitié importé)', async () => {
    const res = await importer([
      { name: 'Vidange', durationMin: 30, unitPrice: 45 },
      { name: 'Freins', durationMin: 60, unitPrice: 'cent' },
    ])
    expect(res.status).toBe(400)
    expect(await prisma.laborOperation.count({ where: { garageId } })).toBe(0)
  })

  it('enregistre exactement un barème valide', async () => {
    expect((await importer([
      { name: 'Vidange', durationMin: 30, unitPrice: 45.5 },
      { name: 'Freins', durationMin: 60, unitPrice: '89,90' },
    ])).status).toBe(201)
    const ops = await prisma.laborOperation.findMany({ where: { garageId }, orderBy: { name: 'asc' } })
    expect(ops.map((o: { unitPriceTenThousandths: number }) => o.unitPriceTenThousandths)).toEqual([899000, 455000])
  })
})

describe('GF31-AUD-051 — réception : une quantité fractionnaire est refusée', () => {
  const commande = async (qtyTenThousandths: number, partId: string) =>
    (await prisma.purchaseOrder.create({
      data: {
        garageId, number: `BC-${qtyTenThousandths}`, supplierName: 'Oscaro', status: 'sent',
        sentAt: new Date(), totalHtCents: 1000,
        // Écriture par le SÉRIALISEUR DE PRODUCTION, jamais à la main : c'est la
        // règle posée par GF31-AUD-002 (et vérifiée par `check:money-json`), et
        // c'est aussi ce qui garantit que ce test exerce le format réel.
        linesJson: serializePoLinesJsonV2([{
          partId, partName: 'Joint', qtyTenThousandths,
          unitCostTenThousandths: 30000,
          lineTotalCents: Math.round((qtyTenThousandths / 10000) * 300),
        }]),
      },
    })).id

  const piece = async () =>
    (await prisma.part.create({
      data: { garageId, name: 'Joint', quantity: 5, minQuantity: 0, unitCostTenThousandths: 30000, unitPriceTenThousandths: 60000 },
    })).id

  it('refuse 2,4 unités au lieu d’enregistrer 2 en silence', async () => {
    const partId = await piece()
    const id = await commande(24000, partId)
    const res = await receive(new Request('http://localhost/x', { method: 'POST' }), { params: { id } })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVALID_STOCK_QUANTITY')

    // La commande reste réceptionnable une fois corrigée, et le stock intact.
    expect((await prisma.purchaseOrder.findUnique({ where: { id } })).status).toBe('sent')
    expect((await prisma.part.findUnique({ where: { id: partId } })).quantity).toBe(5)
  })

  it('accepte une quantité entière et incrémente exactement', async () => {
    const partId = await piece()
    const id = await commande(30000, partId)
    const res = await receive(new Request('http://localhost/x', { method: 'POST' }), { params: { id } })
    expect(res.status).toBe(200)
    expect((await prisma.part.findUnique({ where: { id: partId } })).quantity).toBe(8)
  })
})

describe('GF31-AUD-052 — la quantité saisie n’est plus réécrite en silence', () => {
  const src = () => readFileSync(path.resolve(__dirname, '../components/QuoteInvoiceModal.tsx'), 'utf8')

  it('le motif fautif a disparu du composant', () => {
    // `Number(l.quantity) || 1` : une quantité à 0 devenait 1.
    expect(src()).not.toMatch(/Math\.max\(0\.01,\s*Number\(l\.quantity\)\s*\|\|\s*1\)/)
  })

  it('une quantité invalide interrompt l’enregistrement avec un message', () => {
    const s = src()
    expect(s).toContain('Quantité invalide ligne')
    // …et le refus précède l'envoi : `setSaving(true)` vient après.
    expect(s.indexOf('Quantité invalide ligne')).toBeLessThan(s.lastIndexOf('setSaving(true)'))
  })
})

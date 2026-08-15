/**
 * Le PRIX D'ACHAT ne doit pas sortir par la porte de derrière.
 *
 * `/api/finance`, `/api/profitability` et les résolveurs financiers du copilote
 * exigent `financial:read`, et `redactLineCosts` retire déjà le coût des lignes
 * de devis et de facture (GF31-AUD-009). Mais deux surfaces le laissaient
 * passer sans aucun contrôle :
 *
 *   · le copilote — « quelles pièces sont en rupture ? » répondait
 *     « … (coût estimé 450 €) » à n'importe quel rôle authentifié, et rendait
 *     `estimatedCost` par pièce ;
 *   · `/api/stock-forecast` — `estimatedCost` par pièce et `totalOrderCost` en
 *     résumé, sans le moindre contrôle de rôle.
 *
 * `estimatedCost / recommendedOrderQty` rend le prix d'achat unitaire : c'est
 * bien la marge qui fuyait, pas une donnée d'atelier.
 *
 * Ce qui reste dû à un mécanicien est vérifié aussi : savoir QUELLES pièces
 * manquent et EN QUELLE QUANTITÉ. On retire le prix, pas la réponse.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-cout-achat.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let copilotPOST: (req: Request) => Promise<Response>
let previsionGET: (req: Request) => Promise<Response>
let prisma: any
let garageA: string

const commeRole = (role: string) => { h.session = { user: { id: 'u1', name: 'U', role, garageId: garageA } } }

const demander = async (query: string) => {
  const r = await copilotPOST(new Request('http://localhost/api/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  }))
  return r.json()
}
const prevoir = async () => {
  const r = await previsionGET(new Request('http://localhost/api/stock-forecast'))
  return r.json()
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: copilotPOST } = await import('@/app/api/copilot/route') as any)
  ;({ GET: previsionGET } = await import('@/app/api/stock-forecast/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'cout-a' } })).id
  // Sous le minimum → à réapprovisionner, avec un coût d'achat bien identifiable.
  await prisma.part.create({
    data: { name: 'Plaquettes', reference: 'BRK-9', quantity: 1, minQuantity: 8, unitCostTenThousandths: 123_0000, garageId: garageA },
  })
}, 60_000)

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

describe('le copilote ne livre pas le prix d’achat à un rôle non financier', () => {
  it('un MECHANIC obtient la liste, jamais le coût', async () => {
    commeRole('MECHANIC')
    const json = await demander('Quelles pièces sont en rupture de stock ?')

    expect(json.message, 'le besoin d’atelier est servi').toMatch(/à réapprovisionner/)
    expect(json.message, 'le coût estimé est une donnée financière').not.toMatch(/coût estimé/)
    expect(JSON.stringify(json.data ?? []), 'estimatedCost révèle le prix d’achat unitaire')
      .not.toMatch(/estimatedCost/)
  })

  it('le mécanicien garde ce dont il a besoin : quoi commander, et combien', async () => {
    commeRole('MECHANIC')
    const json = await demander('Quelles pièces sont en rupture de stock ?')
    const [plan] = json.data
    expect(plan.name).toBe('Plaquettes')
    expect(plan.recommendedOrderQty, 'retirer le prix ne doit pas retirer la quantité')
      .toBeGreaterThan(0)
  })

  it('un OWNER, lui, voit le coût — la donnée n’est pas supprimée, elle est réservée', async () => {
    commeRole('OWNER')
    const json = await demander('Quelles pièces sont en rupture de stock ?')
    expect(json.message).toMatch(/coût estimé/)
    expect(JSON.stringify(json.data)).toMatch(/estimatedCost/)
  })
})

describe('/api/stock-forecast applique la même règle', () => {
  it('un MECHANIC n’obtient ni coût par pièce ni total', async () => {
    commeRole('MECHANIC')
    const json = await prevoir()
    expect(JSON.stringify(json.plans)).not.toMatch(/estimatedCost/)
    expect(json.summary.totalOrderCost, 'le total d’achat est la marge agrégée').toBeUndefined()
    expect(json.summary.itemsToReorder, 'le décompte opérationnel reste').toBeGreaterThan(0)
  })

  it('un MANAGER conserve l’accès complet', async () => {
    commeRole('MANAGER')
    const json = await prevoir()
    expect(JSON.stringify(json.plans)).toMatch(/estimatedCost/)
    expect(typeof json.summary.totalOrderCost).toBe('number')
  })
})

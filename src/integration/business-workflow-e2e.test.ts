/**
 * PARCOURS MÉTIER COMPLET bout-en-bout (V13, lot J) — via les VRAIS handlers.
 *
 * Chaîne représentative d'une acquisition : garage → équipe → client → véhicule
 * → RDV → intervention → pièce (stock décrémenté) → devis (numéroté, lignes MO
 * + pièce) → acceptation → conversion en facture (numérotée, totaux exacts) →
 * envoi → paiement → immuabilité → portail client → persistance revérifiée en
 * BASE (pas seulement les réponses HTTP). Scénarios d'échec inclus (relation
 * étrangère, stock insuffisant, double conversion, retour en brouillon).
 *
 * L'authentification est mockée en amont des handlers (session OWNER du garage)
 * — le contrôle d'accès lui-même est couvert par tenant-isolation-matrix et
 * authz-full-matrix ; ici on prouve le MÉTIER et la PERSISTANCE.
 * Le RDV est créé via Prisma : la création côté staff n'a pas d'endpoint POST
 * (les RDV entrent par le portail client, testé séparément).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SignJWT } from 'jose'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-business-e2e.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'portal-secret-e2e-workflow-0123456789abcd'

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

let prisma: any
const api: Record<string, any> = {}
const ids = {
  garageId: '', mechanicId: '', clientId: '', vehicleId: '', jobId: '',
  partId: '', quoteId: '', invoiceId: '', quote2Id: '',
}
const YEAR = new Date().getFullYear()

const jsonReq = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  api.mechanics = await import('@/app/api/mechanics/route')
  api.clients = await import('@/app/api/clients/route')
  api.vehicles = await import('@/app/api/vehicles/route')
  api.jobs = await import('@/app/api/jobs/route')
  api.jobParts = await import('@/app/api/jobs/[id]/parts/route')
  api.parts = await import('@/app/api/parts/route')
  api.quotes = await import('@/app/api/quotes/route')
  api.quoteId = await import('@/app/api/quotes/[id]/route')
  api.convert = await import('@/app/api/quotes/[id]/convert/route')
  api.invoiceId = await import('@/app/api/invoices/[id]/route')
  api.portal = await import('@/app/api/portal/[token]/route')

  const garage = await prisma.garage.create({
    data: {
      name: 'Garage Atelier V13', slug: 'atelier-v13', plan: 'PRO',
      email: 'contact@atelier-v13.exemple.fr', siret: '12345678200010',
      vatNumber: 'FR11123456782', hourlyRateTenThousandths: 650000,
    },
  })
  ids.garageId = garage.id
  const user = await prisma.user.create({
    data: { email: 'owner@atelier-v13.exemple.fr', password: 'x', name: 'Owner', role: 'OWNER', garageId: garage.id },
  })
  h.session = { user: { id: user.id, role: 'OWNER', garageId: garage.id } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('parcours métier complet — garage → facture payée → portail', () => {
  it('1. équipe : création du mécanicien via l’API', async () => {
    const res = await api.mechanics.POST(jsonReq('POST', '/api/mechanics', {
      name: 'Thomas B.', color: '#3b82f6', specialty: ['revision', 'brake_pads'],
    }))
    expect(res.status).toBeLessThan(300)
    const m = await res.json()
    ids.mechanicId = m.id
    expect((await prisma.mechanic.findUnique({ where: { id: m.id } })).garageId).toBe(ids.garageId)
  })

  it('2. client + véhicule (rattachement contrôlé)', async () => {
    const cRes = await api.clients.POST(jsonReq('POST', '/api/clients', {
      name: 'Martin Dupont', phone: '06 11 22 33 44', email: 'martin.dupont@exemple.fr',
    }))
    expect(cRes.status).toBeLessThan(300)
    ids.clientId = (await cRes.json()).id

    const vRes = await api.vehicles.POST(jsonReq('POST', '/api/vehicles', {
      licensePlate: 'ab-123-cd', make: 'Peugeot', model: '308', year: 2019, clientId: ids.clientId,
    }))
    expect(vRes.status).toBeLessThan(300)
    const v = await vRes.json()
    ids.vehicleId = v.id
    expect(v.licensePlate).toBe('AB-123-CD') // normalisation majuscules
  })

  it('2b. ÉCHEC contrôlé : véhicule rattaché au client d’un AUTRE garage → refus', async () => {
    const other = await prisma.garage.create({ data: { name: 'Autre', slug: 'autre-v13' } })
    const foreign = await prisma.client.create({ data: { name: 'Étranger', garageId: other.id } })
    const res = await api.vehicles.POST(jsonReq('POST', '/api/vehicles', {
      licensePlate: 'ZZ-999-ZZ', make: 'X', model: 'Y', clientId: foreign.id,
    }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.vehicle.count({ where: { licensePlate: 'ZZ-999-ZZ' } })).toBe(0)
  })

  it('3. rendez-vous persisté puis intervention créée via l’API', async () => {
    await prisma.appointment.create({
      data: {
        garageId: ids.garageId, clientId: ids.clientId, vehicleId: ids.vehicleId,
        clientName: 'Martin Dupont', reason: 'Révision + freins', date: '2026-08-10',
        startTime: '09:00', durationMin: 120, status: 'confirmed',
      },
    })
    const res = await api.jobs.POST(jsonReq('POST', '/api/jobs', {
      customerName: 'Martin Dupont', vehicleModel: 'Peugeot 308', licensePlate: 'AB-123-CD',
      repairType: 'revision', estimatedDuration: 120, startTime: '09:00', date: '2026-08-10',
      mechanicId: ids.mechanicId, vehicleId: ids.vehicleId,
    }))
    expect(res.status).toBeLessThan(300)
    ids.jobId = (await res.json()).id
    const row = await prisma.job.findUnique({ where: { id: ids.jobId } })
    expect(row.garageId).toBe(ids.garageId)
    expect(row.vehicleId).toBe(ids.vehicleId)
  })

  it('4. stock : pièce créée, consommée sur l’intervention, décrément vérifié en base', async () => {
    const pRes = await api.parts.POST(jsonReq('POST', '/api/parts', {
      reference: 'PLQ-AV-308', name: 'Plaquettes avant', quantity: 10, minQuantity: 4,
      unitCost: 23.1, unitPrice: 45.9,
    }))
    expect(pRes.status).toBeLessThan(300)
    ids.partId = (await pRes.json()).id

    const useRes = await api.jobParts.POST(
      jsonReq('POST', `/api/jobs/${ids.jobId}/parts`, { partId: ids.partId, quantity: 2 }),
      { params: { id: ids.jobId } },
    )
    expect(useRes.status).toBeLessThan(300)
    expect((await prisma.part.findUnique({ where: { id: ids.partId } })).quantity).toBe(8)
  })

  it('4b. ÉCHEC contrôlé : consommation au-delà du stock → 409, stock intact', async () => {
    const res = await api.jobParts.POST(
      jsonReq('POST', `/api/jobs/${ids.jobId}/parts`, { partId: ids.partId, quantity: 999 }),
      { params: { id: ids.jobId } },
    )
    expect(res.status).toBe(409)
    expect((await prisma.part.findUnique({ where: { id: ids.partId } })).quantity).toBe(8)
  })

  it('5. devis numéroté DEV-…-001, lignes MO + pièce, montants exacts en base', async () => {
    const res = await api.quotes.POST(jsonReq('POST', '/api/quotes', {
      clientId: ids.clientId, vehicleId: ids.vehicleId, jobId: ids.jobId,
      clientName: 'Martin Dupont', taxRate: 20,
      lines: [
        { description: 'Plaquettes avant', quantity: 2, unitPrice: 45.9, isLabor: false },
        { description: 'Main-d’œuvre freinage (1,5 h)', quantity: 1.5, unitPrice: 65, isLabor: true },
      ],
    }))
    expect(res.status).toBeLessThan(300)
    const q = await res.json()
    ids.quoteId = q.id
    expect(q.number).toBe(`DEV-${YEAR}-001`)

    // Persistance : la base stocke des ENTIERS exacts (dix-millièmes), et les
    // totaux dérivés sont 2×45,90 + 1,5×65 = 189,30 HT → 37,86 TVA → 227,16 TTC.
    const rows = await prisma.quoteLine.findMany({ where: { quoteId: q.id }, orderBy: { sortOrder: 'asc' } })
    expect(rows.map((r: any) => [r.quantityTenThousandths, r.unitPriceTenThousandths]))
      .toEqual([[20000, 459000], [15000, 650000]])
    // Les totaux dérivés sont exposés par le GET (withTotals) — pas par le POST.
    const getRes = await api.quoteId.GET(jsonReq('GET', `/api/quotes/${q.id}`), { params: { id: q.id } })
    const full = await getRes.json()
    expect(full.totalHT).toBe(189.3)
    expect(full.totalTTC).toBe(227.16)
  })

  it('5b. ÉCHEC contrôlé : devis pointant le client d’un autre garage → refus', async () => {
    const foreign = await prisma.client.findFirst({ where: { name: 'Étranger' } })
    const res = await api.quotes.POST(jsonReq('POST', '/api/quotes', {
      clientId: foreign.id, clientName: 'X', taxRate: 20,
      lines: [{ description: 'l', quantity: 1, unitPrice: 1 }],
    }))
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('6. acceptation du devis puis conversion en facture FAC-…-001', async () => {
    const sent = await api.quoteId.PATCH(jsonReq('PATCH', `/api/quotes/${ids.quoteId}`, { status: 'sent' }), { params: { id: ids.quoteId } })
    expect(sent.status).toBeLessThan(300)
    const acc = await api.quoteId.PATCH(jsonReq('PATCH', `/api/quotes/${ids.quoteId}`, { status: 'accepted' }), { params: { id: ids.quoteId } })
    expect(acc.status).toBeLessThan(300)

    const conv = await api.convert.POST(jsonReq('POST', `/api/quotes/${ids.quoteId}/convert`), { params: { id: ids.quoteId } })
    expect(conv.status).toBeLessThan(300)
    const inv = await conv.json()
    ids.invoiceId = inv.id
    expect(inv.number).toBe(`FAC-${YEAR}-001`)

    // Persistance + exactitude : lignes copiées à l'identique (entiers), et
    // HT/TVA/TTC recalculés depuis la base = 18930/3786/22716 centimes.
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceId: inv.id }, orderBy: { sortOrder: 'asc' } })
    expect(lines.map((r: any) => [r.quantityTenThousandths, r.unitPriceTenThousandths]))
      .toEqual([[20000, 459000], [15000, 650000]])
    const { computeTotals } = await import('@/lib/money')
    const { linesToEuros } = await import('@/lib/money-db')
    const t = computeTotals(linesToEuros(lines) as any, 20)
    expect([t.totalHTCents, t.taxCents, t.totalTTCCents]).toEqual([18930, 3786, 22716])
  })

  it('6b. ÉCHEC contrôlé : double conversion du même devis → refus, pas de 2e facture', async () => {
    const res = await api.convert.POST(jsonReq('POST', `/api/quotes/${ids.quoteId}/convert`), { params: { id: ids.quoteId } })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.invoice.count({ where: { garageId: ids.garageId } })).toBe(1)
  })

  it('7. cycle de paiement : draft → sent → paid, persisté', async () => {
    for (const status of ['sent', 'paid']) {
      const res = await api.invoiceId.PATCH(jsonReq('PATCH', `/api/invoices/${ids.invoiceId}`, { status }), { params: { id: ids.invoiceId } })
      expect(res.status).toBeLessThan(300)
    }
    expect((await prisma.invoice.findUnique({ where: { id: ids.invoiceId } })).status).toBe('paid')
  })

  it('8. IMMUABILITÉ : retour en brouillon → 409 ; suppression → 409 ; base inchangée', async () => {
    const back = await api.invoiceId.PATCH(jsonReq('PATCH', `/api/invoices/${ids.invoiceId}`, { status: 'draft' }), { params: { id: ids.invoiceId } })
    expect(back.status).toBe(409)
    const del = await api.invoiceId.DELETE(jsonReq('DELETE', `/api/invoices/${ids.invoiceId}`), { params: { id: ids.invoiceId } })
    expect(del.status).toBe(409)
    const row = await prisma.invoice.findUnique({ where: { id: ids.invoiceId } })
    expect(row.status).toBe('paid')
  })

  it('9. numérotation contiguë : 2e devis converti → FAC-…-002', async () => {
    const q2 = await api.quotes.POST(jsonReq('POST', '/api/quotes', {
      clientId: ids.clientId, clientName: 'Martin Dupont', taxRate: 20,
      lines: [{ description: 'Essuie-glaces', quantity: 1, unitPrice: 18.9 }],
    }))
    ids.quote2Id = (await q2.json()).id
    await api.quoteId.PATCH(jsonReq('PATCH', `/api/quotes/${ids.quote2Id}`, { status: 'sent' }), { params: { id: ids.quote2Id } })
    await api.quoteId.PATCH(jsonReq('PATCH', `/api/quotes/${ids.quote2Id}`, { status: 'accepted' }), { params: { id: ids.quote2Id } })
    const conv = await api.convert.POST(jsonReq('POST', `/api/quotes/${ids.quote2Id}/convert`), { params: { id: ids.quote2Id } })
    expect((await conv.json()).number).toBe(`FAC-${YEAR}-002`)
    expect((await prisma.garage.findUnique({ where: { id: ids.garageId } })).invoiceCounter).toBe(2)
  })

  it('10. portail client : lien tokenisé du job → 200 ; jeton falsifié → refus', async () => {
    const secret = new TextEncoder().encode(process.env.GF_PORTAL_SECRET)
    const token = await new SignJWT({ typ: 'portal', jobId: ids.jobId, garageId: ids.garageId })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('48h').sign(secret)
    const ok = await api.portal.GET(new Request('http://localhost/api/portal/x'), { params: { token } })
    expect(ok.status).toBe(200)

    const bad = await new SignJWT({ typ: 'portal', jobId: ids.jobId, garageId: ids.garageId })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('48h')
      .sign(new TextEncoder().encode('mauvais-secret-mauvais-secret-123456'))
    expect((await api.portal.GET(new Request('http://localhost/api/portal/x'), { params: { token: bad } })).status).not.toBe(200)
  })

  it('11. bilan de persistance : toutes les entités du parcours existent en base, scopées au garage', async () => {
    const counts = {
      mechanics: await prisma.mechanic.count({ where: { garageId: ids.garageId } }),
      clients: await prisma.client.count({ where: { garageId: ids.garageId } }),
      vehicles: await prisma.vehicle.count({ where: { garageId: ids.garageId } }),
      appointments: await prisma.appointment.count({ where: { garageId: ids.garageId } }),
      jobs: await prisma.job.count({ where: { garageId: ids.garageId } }),
      parts: await prisma.part.count({ where: { garageId: ids.garageId } }),
      jobParts: await prisma.jobPart.count({ where: { job: { garageId: ids.garageId } } }),
      quotes: await prisma.quote.count({ where: { garageId: ids.garageId } }),
      invoices: await prisma.invoice.count({ where: { garageId: ids.garageId } }),
    }
    expect(counts).toEqual({
      mechanics: 1, clients: 1, vehicles: 1, appointments: 1, jobs: 1,
      parts: 1, jobParts: 1, quotes: 2, invoices: 2,
    })
  })
})

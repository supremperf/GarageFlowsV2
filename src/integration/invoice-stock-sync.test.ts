/**
 * SYNCHRONISATION STOCK ↔ FACTURE — bout en bout, via les VRAIS handlers d'API
 * et une VRAIE base SQLite (aucune base simulée : ce qui est prouvé ici est ce
 * qui s'exécutera en production).
 *
 * Couvre la suite de tests exigée par la spécification :
 *   1  stock 10, facture 2, validation           → 8
 *   2  modification 2 → 3                        → 7   (delta = 1, pas 3)
 *   3  modification 3 → 1                        → 9   (restitue 2)
 *   4  annulation                                → 10
 *   5  stock 1, deux validations concurrentes    → une seule consomme
 *   6  ligne main-d'œuvre                        → aucun mouvement
 *   7  ligne libre                               → aucun mouvement
 *   8  devis                                     → aucun décrément
 *   9  conversion devis → facture                → UN seul mouvement définitif
 *   10 deux garages, même référence              → aucune contamination
 *   +  double-clic sur « Valider »               → un seul décrément
 *   +  partId d'un autre garage                  → refusé (IDOR)
 *   +  autocomplétion « F » puis « Fil »         → propositions du bon garage
 *
 * L'authentification est mockée (session OWNER) ; l'isolation multi-garage
 * elle-même est vérifiée ici en BASCULANT de session, pas en la contournant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-invoice-stock.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))

/* eslint-disable  */
let prisma: any
const api: Record<string, any> = {}
let stockLib: typeof import('@/lib/stock/invoice-stock')

const SCALE = 10_000
const ids = { garageA: '', garageB: '', filtreA: '', bougieA: '', filtreB: '' }

const jsonReq = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Bascule la session sur un garage (les deux ont un propriétaire distinct). */
const owners: Record<string, unknown> = {}
function useGarage(garageId: string) { h.session = owners[garageId] }

async function stockOf(partId: string): Promise<number> {
  return (await prisma.part.findUnique({ where: { id: partId } })).quantity
}
async function movementsOf(invoiceId: string) {
  return prisma.stockMovement.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } })
}

/** Crée une facture BROUILLON avec les lignes fournies et renvoie son id. */
async function createInvoice(lines: unknown[]): Promise<any> {
  const res = await api.invoices.POST(jsonReq('POST', '/api/invoices', {
    clientName: 'Pauline', vehicleModel: 'Renault Twingo', licensePlate: 'FZ-319-BZ', lines,
  }))
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(201)
  return body
}

/** PATCH de statut ; renvoie {status, body}. */
async function setStatus(invoiceId: string, status: string) {
  const res = await api.invoiceId.PATCH(
    jsonReq('PATCH', `/api/invoices/${invoiceId}`, { status }),
    { params: { id: invoiceId } },
  )
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  stockLib = await import('@/lib/stock/invoice-stock')
  api.invoices = await import('@/app/api/invoices/route')
  api.invoiceId = await import('@/app/api/invoices/[id]/route')
  api.quotes = await import('@/app/api/quotes/route')
  api.convert = await import('@/app/api/quotes/[id]/convert/route')
  api.partsSearch = await import('@/app/api/parts/search/route')

  for (const [key, name] of [['garageA', 'Garage Test A'], ['garageB', 'Garage Test B']] as const) {
    const g = await prisma.garage.create({ data: { name, slug: `${key}-stock-sync` } })
    const u = await prisma.user.create({
      data: { email: `owner@${key}.test`, password: 'x', name: 'Owner', role: 'OWNER', garageId: g.id },
    })
    ;(ids as any)[key] = g.id
    owners[g.id] = { user: { id: u.id, role: 'OWNER', garageId: g.id } }
  }
  useGarage(ids.garageA)
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

// Catalogue remis à neuf avant CHAQUE test : les scénarios sont indépendants.
beforeEach(async () => {
  await prisma.stockMovement.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.quoteLine.deleteMany({})
  await prisma.quote.deleteMany({})
  await prisma.part.deleteMany({})

  const filtreA = await prisma.part.create({
    data: {
      name: 'Filtre à huile', reference: 'P3312', supplierName: 'Bosch', supplierRef: 'BO-3312',
      quantity: 10, minQuantity: 2, unitPriceTenThousandths: 15 * SCALE, unitCostTenThousandths: 9 * SCALE,
      garageId: ids.garageA,
    },
  })
  const bougieA = await prisma.part.create({
    data: {
      name: 'Bougie', reference: 'B7712', quantity: 4,
      unitPriceTenThousandths: 8 * SCALE, unitCostTenThousandths: 4 * SCALE, garageId: ids.garageA,
    },
  })
  // MÊME référence dans l'autre garage : piège à contamination inter-garage.
  const filtreB = await prisma.part.create({
    data: {
      name: 'Filtre à huile', reference: 'P3312', quantity: 50,
      unitPriceTenThousandths: 15 * SCALE, unitCostTenThousandths: 9 * SCALE, garageId: ids.garageB,
    },
  })
  ids.filtreA = filtreA.id
  ids.bougieA = bougieA.id
  ids.filtreB = filtreB.id
  useGarage(ids.garageA)
})

// ─────────────────────────────────────────────────────────────────────────────

describe('TEST 1 — validation d’une facture : décrément réel', () => {
  it('stock 10, facture de 2 → stock 8, un mouvement SALE de −2', async () => {
    const inv = await createInvoice([
      { description: 'Filtre à huile', quantity: 2, unitPrice: 15, partId: ids.filtreA },
    ])

    // BROUILLON : aucun mouvement définitif.
    expect(await stockOf(ids.filtreA)).toBe(10)
    expect(await movementsOf(inv.id)).toHaveLength(0)

    const r = await setStatus(inv.id, 'sent')
    expect(r.status).toBe(200)

    expect(await stockOf(ids.filtreA)).toBe(8)
    const mv = await movementsOf(inv.id)
    expect(mv).toHaveLength(1)
    expect(mv[0]).toMatchObject({ type: 'SALE', quantityDelta: -2, partId: ids.filtreA, garageId: ids.garageA })
    expect((await prisma.invoice.findUnique({ where: { id: inv.id } })).stockCommittedAt).not.toBeNull()
  })
})

describe('TESTS 2 & 3 — modification : SEUL le delta est appliqué', () => {
  // La règle légale (facture émise = montants figés) interdit ces modifications
  // via l'API ; on exerce donc le rapprochement sur la MÊME base réelle, ce qui
  // est précisément le chemin de code utilisé si le verrou est levé (avoir,
  // régularisation). Le refus de l'API est vérifié par le test suivant.
  async function reconcileAfterEdit(invoiceId: string) {
    return prisma.$transaction(async (tx: any) =>
      stockLib.syncInvoiceStock(tx, { invoiceId, garageId: ids.garageA }))
  }

  it('2 → 3 retire 1 de plus (stock 8 → 7), pas 3 à nouveau', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    expect(await stockOf(ids.filtreA)).toBe(8)

    await prisma.invoiceLine.updateMany({ where: { invoiceId: inv.id }, data: { quantityTenThousandths: 3 * SCALE } })
    const res = await reconcileAfterEdit(inv.id)

    expect(await stockOf(ids.filtreA)).toBe(7)
    expect(res.applied).toEqual([{ partId: ids.filtreA, units: 1 }])
  })

  it('3 → 1 restitue 2 (stock 7 → 9)', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 3, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    expect(await stockOf(ids.filtreA)).toBe(7)

    await prisma.invoiceLine.updateMany({ where: { invoiceId: inv.id }, data: { quantityTenThousandths: 1 * SCALE } })
    await reconcileAfterEdit(inv.id)

    expect(await stockOf(ids.filtreA)).toBe(9)
  })

  it('suppression de la ligne restitue tout', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: inv.id } })
    await reconcileAfterEdit(inv.id)
    expect(await stockOf(ids.filtreA)).toBe(10)
  })

  it('l’API REFUSE de modifier les lignes d’une facture émise (règle légale préservée)', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    const res = await api.invoiceId.PATCH(
      jsonReq('PATCH', `/api/invoices/${inv.id}`, {
        lines: [{ description: 'Filtre', quantity: 3, unitPrice: 15, partId: ids.filtreA }],
      }),
      { params: { id: inv.id } },
    )
    expect(res.status).toBe(409)
    expect(await stockOf(ids.filtreA)).toBe(8) // inchangé
  })
})

describe('TEST 4 — annulation : restitution intégrale', () => {
  it('facture annulée → stock revenu à 10, mouvement CANCEL de +2', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    expect(await stockOf(ids.filtreA)).toBe(8)

    const r = await setStatus(inv.id, 'cancelled')
    expect(r.status).toBe(200)
    expect(await stockOf(ids.filtreA)).toBe(10)

    const mv = await movementsOf(inv.id)
    expect(mv.map((m: any) => [m.type, m.quantityDelta])).toEqual([['SALE', -2], ['CANCEL', 2]])
    // La facture est CONSERVÉE (série séquentielle / FEC), pas supprimée.
    expect(await prisma.invoice.findUnique({ where: { id: inv.id } })).not.toBeNull()
  })

  it('annuler DEUX fois ne restitue pas deux fois', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    await setStatus(inv.id, 'cancelled')
    await setStatus(inv.id, 'cancelled')
    expect(await stockOf(ids.filtreA)).toBe(10)
  })

  it('« cancelled » est TERMINAL : impossible de réactiver pour re-décrémenter', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    await setStatus(inv.id, 'cancelled')
    const back = await setStatus(inv.id, 'sent')
    expect(back.status).toBe(409)
    expect(await stockOf(ids.filtreA)).toBe(10)
  })
})

describe('TEST 5 — concurrence : une seule vente peut consommer la dernière unité', () => {
  it('stock 1, deux factures de 1 validées simultanément → une seule réussit', async () => {
    await prisma.part.update({ where: { id: ids.filtreA }, data: { quantity: 1 } })
    const a = await createInvoice([{ description: 'Filtre', quantity: 1, unitPrice: 15, partId: ids.filtreA }])
    const b = await createInvoice([{ description: 'Filtre', quantity: 1, unitPrice: 15, partId: ids.filtreA }])

    const [ra, rb] = await Promise.all([setStatus(a.id, 'sent'), setStatus(b.id, 'sent')])

    const ok = [ra, rb].filter(r => r.status === 200)
    const ko = [ra, rb].filter(r => r.status === 409)
    expect(ok).toHaveLength(1)
    expect(ko).toHaveLength(1)
    expect(ko[0].body.code).toBe('INSUFFICIENT_STOCK')

    // JAMAIS de stock négatif, et la facture refusée n'est pas passée « sent ».
    expect(await stockOf(ids.filtreA)).toBe(0)
  })

  it('stock insuffisant dès la validation → 409 et AUCUN mouvement (rollback total)', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 99, unitPrice: 15, partId: ids.filtreA }])
    const r = await setStatus(inv.id, 'sent')
    expect(r.status).toBe(409)
    expect(await stockOf(ids.filtreA)).toBe(10)
    expect(await movementsOf(inv.id)).toHaveLength(0)
    // La transaction a TOUT annulé : le statut n'a pas basculé non plus.
    const fresh = await prisma.invoice.findUnique({ where: { id: inv.id } })
    expect(fresh.status).toBe('draft')
    expect(fresh.stockCommittedAt).toBeNull()
  })
})

describe('TESTS 6 & 7 — main-d’œuvre et lignes libres n’impactent pas l’inventaire', () => {
  it('main-d’œuvre seule : aucun mouvement', async () => {
    const inv = await createInvoice([{ description: 'Main-d’œuvre', quantity: 2, unitPrice: 60, isLabor: true }])
    expect((await setStatus(inv.id, 'sent')).status).toBe(200)
    expect(await movementsOf(inv.id)).toHaveLength(0)
  })

  it('ligne libre (pièce commandée spécialement) : aucun mouvement', async () => {
    const inv = await createInvoice([{ description: 'Pièce commandée spécialement', quantity: 1, unitPrice: 120 }])
    expect((await setStatus(inv.id, 'sent')).status).toBe(200)
    expect(await movementsOf(inv.id)).toHaveLength(0)
  })

  it('facture mixte : seule la ligne de stock bouge', async () => {
    const inv = await createInvoice([
      { description: 'Main-d’œuvre', quantity: 1, unitPrice: 60, isLabor: true },
      { description: 'Filtre à huile', quantity: 2, unitPrice: 15, partId: ids.filtreA },
      { description: 'Consommables', quantity: 1, unitPrice: 5 },
      { description: 'Bougie', quantity: 4, unitPrice: 8, partId: ids.bougieA },
    ])
    expect((await setStatus(inv.id, 'sent')).status).toBe(200)
    expect(await stockOf(ids.filtreA)).toBe(8)
    expect(await stockOf(ids.bougieA)).toBe(0)
    expect(await movementsOf(inv.id)).toHaveLength(2)
  })

  it('une ligne marquée main-d’œuvre ne peut PAS engager de stock même avec un partId', async () => {
    const inv = await createInvoice([
      { description: 'Forfait', quantity: 2, unitPrice: 60, isLabor: true, partId: ids.filtreA },
    ])
    expect((await setStatus(inv.id, 'sent')).status).toBe(200)
    expect(await stockOf(ids.filtreA)).toBe(10)
  })
})

describe('TESTS 8 & 9 — devis puis conversion : un SEUL mouvement définitif', () => {
  it('un devis n’engage jamais le stock', async () => {
    const res = await api.quotes.POST(jsonReq('POST', '/api/quotes', {
      clientName: 'Pauline',
      lines: [{ description: 'Filtre à huile', quantity: 2, unitPrice: 15, partId: ids.filtreA }],
    }))
    expect(res.status).toBe(201)
    expect(await stockOf(ids.filtreA)).toBe(10)
    expect(await prisma.stockMovement.count()).toBe(0)
  })

  it('devis → facture → validation : le stock ne bouge QU’UNE fois', async () => {
    const qres = await api.quotes.POST(jsonReq('POST', '/api/quotes', {
      clientName: 'Pauline',
      lines: [{ description: 'Filtre à huile', quantity: 2, unitPrice: 15, partId: ids.filtreA }],
    }))
    const quote = await qres.json()

    const cres = await api.convert.POST(jsonReq('POST', `/api/quotes/${quote.id}/convert`), { params: { id: quote.id } })
    expect(cres.status).toBe(201)
    const invoice = await cres.json()

    // Le lien pièce a bien SUIVI le devis jusqu'à la facture…
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceId: invoice.id } })
    expect(lines[0].partId).toBe(ids.filtreA)
    // …mais la conversion seule n'a rien décrémenté.
    expect(await stockOf(ids.filtreA)).toBe(10)

    expect((await setStatus(invoice.id, 'sent')).status).toBe(200)
    expect(await stockOf(ids.filtreA)).toBe(8)
    expect(await movementsOf(invoice.id)).toHaveLength(1)
  })
})

describe('TEST 10 — isolation inter-garage', () => {
  it('valider une facture du garage A ne touche pas la pièce homonyme du garage B', async () => {
    const inv = await createInvoice([{ description: 'Filtre à huile', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    expect(await stockOf(ids.filtreA)).toBe(8)
    expect(await stockOf(ids.filtreB)).toBe(50) // intact
  })

  it('IDOR — référencer la pièce d’un AUTRE garage est refusé (400), stock intact', async () => {
    const res = await api.invoices.POST(jsonReq('POST', '/api/invoices', {
      clientName: 'Pirate',
      lines: [{ description: 'Filtre', quantity: 1, unitPrice: 15, partId: ids.filtreB }],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PART_NOT_FOUND')
    expect(await stockOf(ids.filtreB)).toBe(50)
  })

  it('IDOR — la facture d’un autre garage est invisible (404)', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 1, unitPrice: 15, partId: ids.filtreA }])
    useGarage(ids.garageB)
    const r = await setStatus(inv.id, 'sent')
    expect(r.status).toBe(404)
    expect(await stockOf(ids.filtreA)).toBe(10)
  })
})

describe('double-clic / rejeu — idempotence', () => {
  it('deux « Valider » simultanés ne décrémentent qu’une fois', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    const [r1, r2] = await Promise.all([setStatus(inv.id, 'sent'), setStatus(inv.id, 'sent')])
    expect([r1.status, r2.status]).toEqual([200, 200])
    expect(await stockOf(ids.filtreA)).toBe(8)
    expect(await movementsOf(inv.id)).toHaveLength(1)
  })

  it('valider puis passer « payée » ne re-décrémente pas', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    await setStatus(inv.id, 'sent')
    await setStatus(inv.id, 'paid')
    await setStatus(inv.id, 'overdue')
    expect(await stockOf(ids.filtreA)).toBe(8)
    expect(await movementsOf(inv.id)).toHaveLength(1)
  })

  it('une facture BROUILLON supprimée ne libère aucun stock (rien n’était engagé)', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 2, unitPrice: 15, partId: ids.filtreA }])
    const res = await api.invoiceId.DELETE(jsonReq('DELETE', `/api/invoices/${inv.id}`), { params: { id: inv.id } })
    expect(res.status).toBe(200)
    expect(await stockOf(ids.filtreA)).toBe(10)
  })
})

describe('validation serveur des quantités', () => {
  it('une quantité FRACTIONNAIRE sur une ligne de stock est refusée à la validation', async () => {
    const inv = await createInvoice([{ description: 'Filtre', quantity: 1.5, unitPrice: 15, partId: ids.filtreA }])
    const r = await setStatus(inv.id, 'sent')
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_STOCK_QUANTITY')
    expect(await stockOf(ids.filtreA)).toBe(10)
  })

  it('deux lignes de la MÊME pièce sont cumulées (et peuvent dépasser le stock)', async () => {
    const inv = await createInvoice([
      { description: 'Filtre', quantity: 6, unitPrice: 15, partId: ids.filtreA },
      { description: 'Filtre (2e ligne)', quantity: 6, unitPrice: 15, partId: ids.filtreA },
    ])
    const r = await setStatus(inv.id, 'sent')
    expect(r.status).toBe(409) // 12 demandés > 10 disponibles
    expect(await stockOf(ids.filtreA)).toBe(10)
  })
})

describe('autocomplétion — API réelle, périmètre garage', () => {
  it('« F » propose les pièces du garage courant, « Fil » affine', async () => {
    await prisma.part.createMany({
      data: [
        { name: 'Filtre à air', reference: 'P4410', quantity: 6, garageId: ids.garageA },
        { name: 'Flexible de frein', reference: 'F1200', quantity: 3, garageId: ids.garageA },
      ],
    })
    const f = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q=F'))).json()
    const fNames = f.data.map((p: any) => p.name)
    expect(fNames).toEqual(expect.arrayContaining(['Filtre à huile', 'Filtre à air', 'Flexible de frein']))

    const fil = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q=Fil'))).json()
    const filNames = fil.data.map((p: any) => p.name)
    expect(filNames).toEqual(expect.arrayContaining(['Filtre à huile', 'Filtre à air']))
    expect(filNames).not.toContain('Flexible de frein')
  })

  it('la suggestion porte tout ce qu’il faut : id, référence, stock, prix', async () => {
    const r = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q=P3312'))).json()
    expect(r.data[0]).toMatchObject({
      id: ids.filtreA, name: 'Filtre à huile', reference: 'P3312',
      supplierName: 'Bosch', quantity: 10, unitPrice: 15, unitCost: 9,
    })
  })

  it('recherche insensible à la casse et aux accents', async () => {
    const r = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q=' + encodeURIComponent('FILTRE A HUILE')))).json()
    expect(r.data.map((p: any) => p.id)).toContain(ids.filtreA)
  })

  it('AUCUNE pièce d’un autre garage n’est proposée', async () => {
    useGarage(ids.garageB)
    const r = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q=P3312'))).json()
    expect(r.data).toHaveLength(1)
    expect(r.data[0].id).toBe(ids.filtreB) // la SIENNE, pas celle du garage A
    expect(r.data.map((p: any) => p.id)).not.toContain(ids.filtreA)
  })

  it('requête vide → aucune suggestion (on ne déverse pas le catalogue)', async () => {
    const r = await (await api.partsSearch.GET(jsonReq('GET', '/api/parts/search?q='))).json()
    expect(r.data).toEqual([])
  })
})

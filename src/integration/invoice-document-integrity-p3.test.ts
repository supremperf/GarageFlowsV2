/**
 * GF31-AUD-046 / 047 / 049 — trois défauts du document comptable, corrigés
 * ensemble parce qu'ils vivent sur le même chemin.
 *
 * · 046 — `vehicleModel` et `licensePlate` étaient ÉCRITS par la route sans
 *   figurer au schéma Zod : la promesse « toute écriture passe par un schéma »
 *   était fausse pour ces deux champs, persistés sans borne de longueur.
 *
 * · 047 — supprimer la facture issue d'une conversion laissait le devis au
 *   statut TERMINAL « converted » avec un `invoiceId` devenu nul
 *   (`onDelete: SetNull`) : plus convertible, plus supprimable, pointant sur
 *   rien. Le garage devait tout ressaisir, en gardant un document mort en base.
 *
 * · 049 — l'identité de l'acheteur d'une facture ÉMISE restait librement
 *   modifiable, sans trace : le numéro séquentiel restait, l'acheteur changeait.
 *   Les montants, eux, étaient déjà figés — la moitié du scellé seulement.
 *
 * Base SQLite réelle + vraies routes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-invoice-p3.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let invoicePATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let invoiceDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let convertPOST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let garageId = ''

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PATCH: invoicePATCH, DELETE: invoiceDELETE } = (await import('@/app/api/invoices/[id]/route')) as any)
  ;({ POST: convertPOST } = (await import('@/app/api/quotes/[id]/convert/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Docs', slug: 'aud-p3' } })).id
  h.session = { user: { id: 'u', name: 'Alice', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.auditLog.deleteMany({})
  await prisma.invoiceLine.deleteMany({})
  await prisma.quoteLine.deleteMany({})
  await prisma.invoice.deleteMany({ where: { garageId } })
  await prisma.quote.deleteMany({ where: { garageId } })
})

let n = 0
async function facture(status: string): Promise<string> {
  n += 1
  return (await prisma.invoice.create({
    data: {
      garageId, number: `FAC-2026-${String(n).padStart(3, '0')}`, clientName: 'Client A',
      status, taxRate: 20, issueDate: '2026-06-01',
      lines: { create: [{ description: 'Vidange', quantityTenThousandths: 10000, unitPriceTenThousandths: 900000, sortOrder: 0 }] },
    },
  })).id
}

async function devisAccepte(): Promise<string> {
  n += 1
  return (await prisma.quote.create({
    data: {
      garageId, number: `DEV-2026-${String(n).padStart(3, '0')}`, clientName: 'Client A',
      status: 'accepted', taxRate: 20, issueDate: '2026-06-01',
      lines: { create: [{ description: 'Vidange', quantityTenThousandths: 10000, unitPriceTenThousandths: 900000, sortOrder: 0 }] },
    },
  })).id
}

const patcher = (id: string, corps: Record<string, unknown>) =>
  invoicePATCH(
    new Request(`http://localhost/api/invoices/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
    }),
    { params: { id } },
  )

const supprimer = (id: string) =>
  invoiceDELETE(new Request(`http://localhost/api/invoices/${id}`, { method: 'DELETE' }), { params: { id } })

const convertir = (id: string) =>
  convertPOST(new Request(`http://localhost/api/quotes/${id}/convert`, { method: 'POST' }), { params: { id } })

describe('GF31-AUD-046 — plus aucune écriture hors schéma', () => {
  it('refuse une plaque hors bornes au lieu de la persister', async () => {
    const id = await facture('draft')
    const res = await patcher(id, { licensePlate: 'X'.repeat(500) })
    expect(res.status).toBe(400)
    expect((await prisma.invoice.findUnique({ where: { id } })).licensePlate).toBeNull()
  })

  it('accepte une valeur légitime', async () => {
    const id = await facture('draft')
    expect((await patcher(id, { vehicleModel: 'Clio IV', licensePlate: 'AA-123-BB' })).status).toBe(200)
    const f = await prisma.invoice.findUnique({ where: { id } })
    expect(f.vehicleModel).toBe('Clio IV')
    expect(f.licensePlate).toBe('AA-123-BB')
  })
})

describe('GF31-AUD-049 — l’identité de l’acheteur est scellée avec le document', () => {
  it.each(['sent', 'paid', 'overdue'])('facture %s : le nom du client n’est plus modifiable', async (statut) => {
    const id = await facture(statut)
    const res = await patcher(id, { clientName: 'Autre Client' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVOICE_IDENTITY_LOCKED')
    expect((await prisma.invoice.findUnique({ where: { id } })).clientName).toBe('Client A')
  })

  it.each([
    ['clientEmail', 'autre@example.fr'],
    ['clientPhone', '0600000000'],
    ['clientAddress', '2 rue Neuve'],
    ['vehicleModel', 'Autre modèle'],
    ['licensePlate', 'ZZ-999-ZZ'],
  ])('facture émise : %s est également scellé', async (champ, valeur) => {
    const id = await facture('sent')
    expect((await patcher(id, { [champ]: valeur })).status).toBe(409)
  })

  it('un BROUILLON reste librement modifiable', async () => {
    const id = await facture('draft')
    expect((await patcher(id, { clientName: 'Autre Client' })).status).toBe(200)
    expect((await prisma.invoice.findUnique({ where: { id } })).clientName).toBe('Autre Client')
  })

  it('les champs NON identitaires restent modifiables sur une facture émise', async () => {
    const id = await facture('sent')
    // Notes et échéance ne font pas partie de l'identité de l'acheteur.
    expect((await patcher(id, { notes: 'Relancé le 12/08', dueDate: '2026-07-31' })).status).toBe(200)
  })
})

describe('GF31-AUD-047 — supprimer la facture rend le devis à son état d’avant', () => {
  it('le devis redevient accepté, sans pointeur mort, et reconvertible', async () => {
    const devisId = await devisAccepte()
    const conv = await convertir(devisId)
    expect(conv.status).toBe(201)
    const factureId = (await conv.json()).id

    let devis = await prisma.quote.findUnique({ where: { id: devisId } })
    expect(devis.status).toBe('converted')
    expect(devis.invoiceId).toBe(factureId)

    // La facture est encore un brouillon : sa suppression est légitime.
    expect((await supprimer(factureId)).status).toBe(200)

    devis = await prisma.quote.findUnique({ where: { id: devisId } })
    expect(devis.status).toBe('accepted')
    expect(devis.invoiceId).toBeNull()

    // …et il est de nouveau convertible, ce qui était le vrai dommage.
    expect((await convertir(devisId)).status).toBe(201)
  })

  it('un devis d’un AUTRE garage n’est jamais touché', async () => {
    const autre = (await prisma.garage.create({ data: { name: 'B', slug: 'aud-p3-b' } })).id
    const factureId = await facture('draft')
    const devisEtranger = await prisma.quote.create({
      data: {
        garageId: autre, number: 'DEV-B-001', clientName: 'X', status: 'converted',
        taxRate: 20, issueDate: '2026-06-01', invoiceId: factureId,
      },
    })
    expect((await supprimer(factureId)).status).toBe(200)
    const apres = await prisma.quote.findUnique({ where: { id: devisEtranger.id } })
    expect(apres.status).toBe('converted')
  })
})

describe('GF31-AUD-048 — la conversion laisse une trace au journal d’audit', () => {
  it('crée une entrée nommant l’auteur et le devis d’origine', async () => {
    const devisId = await devisAccepte()
    const conv = await convertir(devisId)
    const factureId = (await conv.json()).id

    const entree = await prisma.auditLog.findFirst({
      where: { garageId, entityType: 'Invoice', entityId: factureId, action: 'create' },
    })
    expect(entree).not.toBeNull()
    expect(entree.userName).toBe('Alice')
    const details = JSON.parse(entree.details)
    expect(details.fromQuoteId).toBe(devisId)
    expect(details.via).toBe('quote-conversion')
  })
})

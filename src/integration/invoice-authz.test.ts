/**
 * GF31-AUD-009 — autorisation sur les documents financiers.
 *
 * Base SQLite RÉELLE + vraies routes : seule la session est simulée, pour jouer
 * successivement les trois rôles du produit.
 *
 * ─── Défaut n°1 : la matrice était décorative ───────────────────────────────
 * `src/lib/authz.ts` réserve `invoice:manage` à MANAGER et OWNER — un
 * RECEPTIONIST a `quote:manage`, PAS `invoice:manage`. Or aucune route de
 * facturation ne vérifiait quoi que ce soit : `POST /api/invoices`,
 * `PATCH`/`DELETE /api/invoices/[id]` et `POST /api/quotes/[id]/convert`
 * n'appelaient jamais `can()`. N'importe quel utilisateur authentifié du garage
 * pouvait donc émettre, modifier, encaisser et supprimer des factures.
 *
 * ─── Défaut n°2 : le verrou `financial:read` se contournait ─────────────────
 * `InvoiceLine`/`QuoteLine` portent `unitCostTenThousandths` — le prix d'achat,
 * donc la marge. `/api/finance`, `/api/profitability`, `/api/forecast`,
 * `/api/export/fec` et `/api/copilot/*` exigent tous `financial:read`, mais
 * `GET /api/invoices` et `GET /api/quotes` servaient les lignes brutes, coût
 * inclus, à tout le monde. La porte fermée d'un côté restait ouverte de l'autre.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-invoice-authz.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let invoicesGET: (req: Request) => Promise<Response>
let invoicesPOST: (req: Request) => Promise<Response>
let invoicePATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let invoiceDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let convertPOST: (req: Request, ctx: { params: { id: string } }) => Promise<Response>

let garageId = ''
let invoiceId = ''
let quoteId = ''

/** Joue un rôle le temps d'un appel. */
function commeRole(role: string): void {
  h.session = { user: { id: `u-${role}`, name: role, role, garageId } }
}

const COUT_ACHAT_SCALED = 400000 // 40,0000 € — la marge à protéger
const PRIX_VENTE_SCALED = 1000000 // 100,0000 €

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: invoicesGET, POST: invoicesPOST } = (await import('@/app/api/invoices/route')) as any)
  ;({ PATCH: invoicePATCH, DELETE: invoiceDELETE } = (await import('@/app/api/invoices/[id]/route')) as any)
  ;({ POST: convertPOST } = (await import('@/app/api/quotes/[id]/convert/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Authz', slug: 'authz-aud-009' } })).id

  invoiceId = (await prisma.invoice.create({
    data: {
      number: 'FAC-2026-500', garageId, clientName: 'Client', status: 'draft',
      issueDate: '2026-05-01', taxRate: 20,
      lines: {
        create: [{
          description: 'Plaquettes', sortOrder: 0,
          quantityTenThousandths: 10000,
          unitPriceTenThousandths: PRIX_VENTE_SCALED,
          unitCostTenThousandths: COUT_ACHAT_SCALED,
        }],
      },
    },
  })).id

  quoteId = (await prisma.quote.create({
    data: {
      number: 'DEV-2026-500', garageId, clientName: 'Client', status: 'draft',
      issueDate: '2026-05-01', taxRate: 20,
      lines: {
        create: [{
          description: 'Plaquettes', sortOrder: 0,
          quantityTenThousandths: 10000,
          unitPriceTenThousandths: PRIX_VENTE_SCALED,
          unitCostTenThousandths: COUT_ACHAT_SCALED,
        }],
      },
    },
  })).id
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

const listeFactures = () => invoicesGET(new Request('http://localhost/api/invoices'))

describe('GF31-AUD-009 — mutations de factures réservées à invoice:manage', () => {
  it('un RECEPTIONIST ne peut pas créer de facture', async () => {
    commeRole('RECEPTIONIST')
    const res = await invoicesPOST(new Request('http://localhost/api/invoices', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientName: 'X', issueDate: '2026-05-02', taxRate: 20, lines: [] }),
    }))
    expect(res.status).toBe(403)
  })

  it('un RECEPTIONIST ne peut ni modifier ni supprimer une facture', async () => {
    commeRole('RECEPTIONIST')
    const patch = await invoicePATCH(
      new Request('http://localhost/api/invoices/x', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      }),
      { params: { id: invoiceId } },
    )
    expect(patch.status).toBe(403)

    const del = await invoiceDELETE(
      new Request('http://localhost/api/invoices/x', { method: 'DELETE' }),
      { params: { id: invoiceId } },
    )
    expect(del.status).toBe(403)

    // Et la facture est INTACTE en base — le refus n'est pas cosmétique.
    const apres = await prisma.invoice.findFirst({ where: { id: invoiceId } })
    expect(apres).not.toBeNull()
    expect(apres.status).toBe('draft')
  })

  it('un RECEPTIONIST ne peut pas contourner en convertissant un devis', async () => {
    commeRole('RECEPTIONIST')
    const res = await convertPOST(
      new Request('http://localhost/api/quotes/x/convert', { method: 'POST' }),
      { params: { id: quoteId } },
    )
    expect(res.status).toBe(403)
    // Aucune facture supplémentaire n'a été émise.
    expect(await prisma.invoice.count({ where: { garageId } })).toBe(1)
  })

  it('un MANAGER conserve tous ses droits de facturation', async () => {
    commeRole('MANAGER')
    const res = await invoicePATCH(
      new Request('http://localhost/api/invoices/x', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientName: 'Client renommé' }),
      }),
      { params: { id: invoiceId } },
    )
    expect(res.status).toBe(200)
  })
})

describe('GF31-AUD-009 — le coût d’achat n’est servi qu’avec financial:read', () => {
  it('un RECEPTIONIST lit la facture mais SANS le coût d’achat', async () => {
    commeRole('RECEPTIONIST')
    const body = await (await listeFactures()).json()
    const ligne = body.data[0].lines[0]

    expect(ligne.description).toBe('Plaquettes')
    expect(ligne.unitPrice).toBeCloseTo(100, 4)      // le prix de vente reste visible
    expect('unitCost' in ligne).toBe(false)          // la marge, non
    expect('unitCostTenThousandths' in ligne).toBe(false)
    // Ceinture et bretelles : le coût n'apparaît nulle part dans la réponse.
    expect(JSON.stringify(body)).not.toContain(String(COUT_ACHAT_SCALED))
  })

  it('un MANAGER (financial:read) voit bien le coût d’achat', async () => {
    commeRole('MANAGER')
    const body = await (await listeFactures()).json()
    const ligne = body.data[0].lines[0]
    expect(ligne.unitCost).toBeCloseTo(40, 4)
    expect(ligne.unitCostTenThousandths).toBe(COUT_ACHAT_SCALED)
  })

  it('un OWNER voit également le coût d’achat', async () => {
    commeRole('OWNER')
    const body = await (await listeFactures()).json()
    expect(body.data[0].lines[0].unitCost).toBeCloseTo(40, 4)
  })
})

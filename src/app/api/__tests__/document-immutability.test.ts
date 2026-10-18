/**
 * Immutabilité des documents légaux — preuve de bout en bout que le
 * contournement par rétrogradation de statut est FERMÉ (findings AUD).
 *
 * Avant correctif : PATCH {status:'draft'} sur une facture émise / un OR signé
 * passait (le verrou ne couvrait que lignes/TVA), puis un second appel
 * ré-éditait ou supprimait le document scellé.
 * Après correctif : la machine à états (lib/document-status) refuse tout retour
 * à « draft » (409) ; le DELETE d'un OR signé est refusé quel que soit le statut.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  workOrder: null as Record<string, unknown> | null,
  invoiceUpdated: false,
  invoiceDeleted: false,
  workOrderDeleted: false,
}))

vi.mock('@/lib/db', () => ({
  // Le verrou de ligne anti-TOCTOU (GF31-AUD-010) n'est posé que sur PostgreSQL ;
  // ce simulacre joue le poste SQLite, où les écritures sont déjà sérialisées.
  isPostgresDatabase: () => false,
  prisma: {
    invoice: {
      findFirst: async () => state.invoice,
      update: async (args: { data: Record<string, unknown> }) => { state.invoiceUpdated = true; return { ...state.invoice, ...args.data, lines: [] } },
      delete: async () => { state.invoiceDeleted = true; return state.invoice },
    },
    invoiceLine: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    part: { findMany: async () => [], updateMany: async () => ({ count: 1 }) },
    workOrder: {
      findFirst: async () => state.workOrder,
      updateMany: async () => ({ count: 1 }),
      deleteMany: async () => { state.workOrderDeleted = true; return { count: 1 } },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      // tx reflète le vrai client Prisma : le re-contrôle anti-TOCTOU lit l'état
      // COURANT dans la transaction (findFirst) avant de muter.
      invoice: {
        findFirst: async () => state.invoice,
        update: async (args: { data: Record<string, unknown> }) => { state.invoiceUpdated = true; return { ...state.invoice, ...args.data, lines: [] } },
        // Verrou d'idempotence du décrément de stock : la revendication réussit
        // une fois (facture jamais engagée dans ce scénario).
        updateMany: async () => ({ count: 1 }),
      },
      invoiceLine: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
        // Aucune ligne rattachée à une pièce ⇒ aucun mouvement de stock.
        findMany: async () => [],
      },
      part: { findMany: async () => [], updateMany: async () => ({ count: 1 }) },
      stockMovement: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
    }),
  },
}))
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'u1', role: 'OWNER', garageId: 'gA' } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => { try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e } },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/tenant', () => ({ assertRelations: async () => null }))

import { PATCH as INVOICE_PATCH, DELETE as INVOICE_DELETE } from '@/app/api/invoices/[id]/route'
import { PATCH as WO_PATCH, DELETE as WO_DELETE } from '@/app/api/work-orders/[id]/route'

const json = (body: unknown) =>
  new Request('http://127.0.0.1/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = () => new Request('http://127.0.0.1/x', { method: 'DELETE' })

const invoicePatch = (body: unknown) => (INVOICE_PATCH as never as (r: Request, c: unknown) => Promise<Response>)(json(body), { params: { id: 'I1' } })
const invoiceDelete = () => (INVOICE_DELETE as never as (r: Request, c: unknown) => Promise<Response>)(del(), { params: { id: 'I1' } })
const woPatch = (body: unknown) => (WO_PATCH as never as (r: Request, c: unknown) => Promise<Response>)(json(body), { params: { id: 'W1' } })
const woDelete = () => (WO_DELETE as never as (r: Request, c: unknown) => Promise<Response>)(del(), { params: { id: 'W1' } })

beforeEach(() => {
  state.invoice = null; state.workOrder = null
  state.invoiceUpdated = false; state.invoiceDeleted = false; state.workOrderDeleted = false
})

describe('Facture émise — rétrogradation impossible', () => {
  it('PATCH {status:draft} sur une facture payée → 409, aucune écriture', async () => {
    state.invoice = { id: 'I1', garageId: 'gA', status: 'paid' }
    const res = await invoicePatch({ status: 'draft' })
    expect(res.status).toBe(409)
    expect(state.invoiceUpdated).toBe(false)
  })
  it('ré-édition des lignes d\'une facture émise → 409', async () => {
    state.invoice = { id: 'I1', garageId: 'gA', status: 'sent' }
    const res = await invoicePatch({ lines: [{ description: 'x', quantity: 1, unitPrice: 10 }] })
    expect(res.status).toBe(409)
    expect(state.invoiceUpdated).toBe(false)
  })
  it('DELETE d\'une facture émise → 409, non supprimée', async () => {
    state.invoice = { id: 'I1', garageId: 'gA', status: 'sent' }
    const res = await invoiceDelete()
    expect(res.status).toBe(409)
    expect(state.invoiceDeleted).toBe(false)
  })
  it('transition avant légitime draft→sent → 200', async () => {
    state.invoice = { id: 'I1', garageId: 'gA', status: 'draft' }
    const res = await invoicePatch({ status: 'sent' })
    expect(res.status).toBe(200)
    expect(state.invoiceUpdated).toBe(true)
  })
})

describe('Ordre de réparation signé — scellé', () => {
  it('PATCH {status:draft} sur un OR signé → 409', async () => {
    state.workOrder = { id: 'W1', garageId: 'gA', status: 'signed', signedAt: new Date(), signatureData: 'sig' }
    const res = await woPatch({ status: 'draft' })
    expect(res.status).toBe(409)
  })
  it('DELETE d\'un OR signé → 400 (scellé), même en tentant via statut', async () => {
    state.workOrder = { id: 'W1', garageId: 'gA', status: 'signed', signedAt: new Date(), signatureData: 'sig' }
    const res = await woDelete()
    expect(res.status).toBe(400)
    expect(state.workOrderDeleted).toBe(false)
  })
})

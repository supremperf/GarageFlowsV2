/**
 * Numérotation atomique des documents (Phase 11) — route /api/invoices.
 *
 * Base simulée : compteur du garage + magasin de factures appliquant la
 * contrainte @@unique([garageId, number]). Vérifie :
 *  - réservation du numéro + création dans la MÊME transaction ;
 *  - numéros distincts sur créations successives ;
 *  - contrainte d'unicité → 409 (P2002) ;
 *  - rollback : si la création échoue, le compteur n'avance pas (pas de trou).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const H = vi.hoisted(() => {
  const state = {
    counter: 0,
    prefix: 'FAC',
    numbers: new Set<string>(),
    failCreate: false,
    inTx: false,
  }
  class P2002 extends Error { code = 'P2002' }
  const makeClient = () => ({
    garage: {
      update: async () => {
        state.counter += 1
        return { invoiceCounter: state.counter, invoicePrefix: state.prefix, taxRate: 20 }
      },
    },
    invoice: {
      create: async ({ data }: any) => {
        if (state.failCreate) throw new Error('boom')
        const key = `A::${data.number}`
        if (state.numbers.has(key)) throw new P2002()
        state.numbers.add(key)
        return { id: `inv-${state.numbers.size}`, ...data, lines: [] }
      },
    },
  })
  return { state, makeClient }
})

const state = H.state

vi.mock('@/lib/db', () => {
  const base = H.makeClient()
  return {
    prisma: {
      ...base,
      // $transaction interactif : exécute le callback avec un client transactionnel.
      // Un throw à l'intérieur annule l'incrément du compteur (rollback simulé).
      $transaction: async (fn: any) => {
        const before = state.counter
        try {
          return await fn(H.makeClient())
        } catch (e) {
          state.counter = before   // rollback de l'incrément
          throw e
        }
      },
    },
  }
})
vi.mock('@/lib/api-helpers', async () => {
  const { NextResponse } = await import('next/server')
  return {
    requireSession: async () => ({ user: { id: 'u1', name: 'U', garageId: 'A' } }),
    // Réplique le comportement réel : capture les throw → 500, laisse passer les NextResponse.
    withAuth: (h: any) => async (req: any, ctx: any) => {
      try { return await h(req, ctx) } catch (e) {
        if (e instanceof NextResponse) return e
        return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
      }
    },
  }
})
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('@/lib/tenant', () => ({ assertRelations: async () => null }))
vi.mock('@/lib/schemas', () => ({ CreateInvoiceSchema: { safeParse: () => ({ success: true, data: {} }) } }))

import { POST } from '@/app/api/invoices/route'

function post(body: unknown = { lines: [] }) {
  return POST(new Request('http://127.0.0.1/api/invoices', { method: 'POST', body: JSON.stringify(body) }) as never)
}

beforeEach(() => {
  state.counter = 0
  state.numbers.clear()
  state.failCreate = false
})

describe('numérotation des factures — atomique et unique', () => {
  it('produit des numéros séquentiels distincts', async () => {
    const r1 = await post(); const j1 = await r1.json()
    const r2 = await post(); const j2 = await r2.json()
    const r3 = await post(); const j3 = await r3.json()
    const year = new Date().getFullYear()
    expect(j1.number).toBe(`FAC-${year}-001`)
    expect(j2.number).toBe(`FAC-${year}-002`)
    expect(j3.number).toBe(`FAC-${year}-003`)
    expect(new Set([j1.number, j2.number, j3.number]).size).toBe(3)
  })

  it('rollback : si la création échoue, le compteur ne laisse pas de trou', async () => {
    await post()                       // FAC-...-001, compteur = 1
    state.failCreate = true
    const rFail = await post()         // échoue → compteur doit revenir à 1
    expect(rFail.status).toBe(500)
    expect(state.counter).toBe(1)
    state.failCreate = false
    const rOk = await post(); const jOk = await rOk.json()
    const year = new Date().getFullYear()
    expect(jOk.number).toBe(`FAC-${year}-002`)   // pas de saut à 003
  })

  it('contrainte d’unicité : un numéro déjà pris renvoie 409', async () => {
    const year = new Date().getFullYear()
    state.numbers.add(`A::FAC-${year}-001`)   // numéro déjà présent
    const res = await post()
    expect(res.status).toBe(409)
  })
})

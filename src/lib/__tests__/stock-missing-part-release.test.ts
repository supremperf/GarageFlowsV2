/**
 * GF31-AUD-015 (moteur) — restitution quand la pièce n'existe plus.
 *
 * Complément au test d'intégration : ici le journal SURVIT à la pièce (base sans
 * cascade appliquée). `reconcile()` doit alors restituer ce qu'il peut, signaler
 * la pièce absente dans `missingParts`, et surtout **ne pas lever** — c'est le
 * blocage définitif de l'annulation qui constituait le défaut.
 */
import { describe, it, expect } from 'vitest'
import { releaseInvoiceStock, type StockTxClient } from '@/lib/stock/invoice-stock'

/** Base simulée : la pièce « absente » refuse tout updateMany (count 0). */
function faireTx(piecesPresentes: Set<string>) {
  const mouvementsEcrits: Array<Record<string, unknown>> = []
  const tx: StockTxClient = {
    invoice: { updateMany: async () => ({ count: 1 }) },
    invoiceLine: { findMany: async () => [] },
    part: {
      updateMany: async (a: any) =>
        ({ count: piecesPresentes.has(String(a.where.id)) ? 1 : 0 }),
      findMany: async () => [],
    },
    stockMovement: {
      findMany: async () => [
        { partId: 'presente', quantityDelta: -2 },
        { partId: 'disparue', quantityDelta: -3 },
      ],
      createMany: async (a: any) => { mouvementsEcrits.push(...a.data); return null },
    },
  }
  return { tx, mouvementsEcrits }
}

describe('GF31-AUD-015 — reconcile ne bloque plus sur une pièce disparue', () => {
  it('n’échoue pas, restitue la pièce présente et signale l’absente', async () => {
    const { tx, mouvementsEcrits } = faireTx(new Set(['presente']))

    const res = await releaseInvoiceStock(tx, {
      invoiceId: 'inv-1', garageId: 'gA', number: 'FAC-1',
    })

    expect(res.changed).toBe(true)
    expect(res.missingParts).toEqual(['disparue'])
    // Un seul mouvement écrit : celui de la pièce qui existe encore. Écrire pour
    // l'autre violerait la clé étrangère.
    expect(mouvementsEcrits).toHaveLength(1)
    expect(mouvementsEcrits[0].partId).toBe('presente')
    expect(mouvementsEcrits[0].quantityDelta).toBe(2) // restitution (+2)
  })

  it('quand tout est présent, rien n’est signalé et les deux mouvements sont écrits', async () => {
    const { tx, mouvementsEcrits } = faireTx(new Set(['presente', 'disparue']))
    const res = await releaseInvoiceStock(tx, { invoiceId: 'inv-1', garageId: 'gA' })
    expect(res.missingParts).toEqual([])
    expect(mouvementsEcrits).toHaveLength(2)
  })
})

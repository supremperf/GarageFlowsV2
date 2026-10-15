/**
 * GF-DUR-037 — le décrément de stock résiste à un entrelacement IMPOSÉ.
 *
 * ─── Pourquoi ce test s'ajoute à `integration/invoice-stock-sync.test.ts` ───
 * Celui-ci contient déjà « stock 1, deux factures de 1 validées simultanément →
 * une seule réussit », lancé par `Promise.all`. Il est utile, et une mutation
 * (retrait du prédicat `quantity >= units`) le fait bien tomber.
 *
 * Mais il ne peut PAS départager ce qu'il annonce. Avec un stock de 1 et deux
 * demandes de 1, une exécution strictement SÉQUENTIELLE donne le même résultat :
 * la première consomme, la seconde voit 0 et échoue. Le test passerait donc
 * même si les deux opérations ne se chevauchaient jamais — et `Promise.all` ne
 * garantit aucun chevauchement. C'est exactement le faux PASS déjà rencontré sur
 * les codes de secours du portail (GF-DUR-025).
 *
 * Ici l'entrelacement n'est pas espéré, il est IMPOSÉ : les deux lectures
 * d'engagement ont lieu avant la première écriture, et les deux `updateMany`
 * sont relâchés dans un ordre choisi. Le résultat ne dépend plus de
 * l'ordonnanceur.
 *
 * Le module expose `StockTxClient` précisément pour cela : le cœur est écrit
 * contre une interface, pas contre Prisma.
 */

import { describe, it, expect } from 'vitest'
import { commitInvoiceStock, InventoryError, type StockTxClient } from '../invoice-stock'

const GARAGE = 'g1'
const PIECE = 'p1'
/** Les quantités de ligne sont stockées en DIX-MILLIÈMES d'unité. */
const UNITE = 10_000

/**
 * Base simulée, avec un point de suspension AVANT chaque écriture de stock.
 *
 * `updateMany` applique la même règle que le moteur : la mise à jour ne touche
 * la ligne que si la condition `quantity >= units` est encore vraie AU MOMENT
 * de l'écriture — pas au moment de la lecture.
 */
function depotPilote(quantiteInitiale: number) {
  const etat = { quantite: quantiteInitiale, engagees: new Set<string>() }
  const attentes: Array<() => void> = []
  const mouvements: Array<{ invoiceId: string; partId: string; quantity: number }> = []

  /** Forme des arguments Prisma dont ce double a besoin. */
  type Args = { where: Record<string, unknown>; data: Record<string, unknown> }

  const tx: StockTxClient = {
    invoice: {
      async updateMany(a: Args) {
        // Revendication d'engagement (idempotence) : `stockCommittedAt: null`.
        const id = String((a.where as { id?: string }).id)
        const exigeNonEngagee = 'stockCommittedAt' in (a.where as object)
        if (exigeNonEngagee && etat.engagees.has(id)) return { count: 0 }
        etat.engagees.add(id)
        return { count: 1 }
      },
    },
    invoiceLine: {
      async findMany() {
        return [{ partId: PIECE, quantityTenThousandths: UNITE, description: 'Filtre', isLabor: false }] as never
      },
    },
    part: {
      async updateMany(a: Args) {
        await new Promise<void>((r) => attentes.push(r))
        const w = a.where as { quantity?: { gte?: number } }
        const data = a.data as { quantity?: { decrement?: number; increment?: number } }
        const dec = data.quantity?.decrement ?? 0
        const inc = data.quantity?.increment ?? 0
        const seuil = w.quantity?.gte
        if (seuil !== undefined && etat.quantite < seuil) return { count: 0 }
        etat.quantite = etat.quantite - dec + inc
        return { count: 1 }
      },
      async findMany() {
        return [{ id: PIECE, name: 'Filtre', quantity: etat.quantite }] as never
      },
    },
    stockMovement: {
      async findMany() { return [] as never },
      async createMany(a: unknown) {
        const d = (a as { data: Array<{ invoiceId: string; partId: string; quantity: number }> }).data
        mouvements.push(...d)
        return { count: d.length }
      },
      async create(a: unknown) {
        mouvements.push((a as { data: never }).data)
        return {} as never
      },
    },
  } as unknown as StockTxClient

  return {
    tx,
    etat,
    mouvements,
    async attendre(n: number) {
      for (let i = 0; i < 400 && attentes.length < n; i++) await new Promise((r) => setTimeout(r, 0))
      expect(attentes.length, 'les deux opérations ne se sont pas chevauchées').toBe(n)
    },
    async relacher() {
      for (let tour = 0; tour < 8; tour++) {
        attentes.splice(0).forEach((r) => r())
        await new Promise((r) => setTimeout(r, 0))
      }
    },
  }
}

describe('décrément de stock — entrelacement imposé (GF-DUR-037)', () => {
  it('deux ventes de la DERNIÈRE unité : une seule consomme, jamais de stock négatif', async () => {
    const d = depotPilote(1)

    // Les deux opérations atteignent leur écriture AVANT que l'une n'ait abouti :
    // c'est l'ordre exact où un « lire puis écrire » produirait -1.
    const p1 = commitInvoiceStock(d.tx, { invoiceId: 'f1', garageId: GARAGE }).catch((e) => e)
    const p2 = commitInvoiceStock(d.tx, { invoiceId: 'f2', garageId: GARAGE }).catch((e) => e)
    await d.attendre(2)
    await d.relacher()
    const [r1, r2] = await Promise.all([p1, p2])

    const echecs = [r1, r2].filter((r) => r instanceof InventoryError)
    expect(echecs, 'une seule des deux ventes doit échouer').toHaveLength(1)
    expect((echecs[0] as InventoryError).code).toBe('INSUFFICIENT_STOCK')

    // LA propriété qui compte : le stock ne descend jamais sous zéro.
    expect(d.etat.quantite).toBe(0)
    expect(d.etat.quantite).toBeGreaterThanOrEqual(0)
  })

  it('stock suffisant pour les deux : les deux passent, et le compte est juste', async () => {
    // Contrôle POSITIF — sans lui, le test précédent passerait aussi si tout
    // était systématiquement refusé.
    const d = depotPilote(2)

    const p1 = commitInvoiceStock(d.tx, { invoiceId: 'f1', garageId: GARAGE }).catch((e) => e)
    const p2 = commitInvoiceStock(d.tx, { invoiceId: 'f2', garageId: GARAGE }).catch((e) => e)
    await d.attendre(2)
    await d.relacher()
    const [r1, r2] = await Promise.all([p1, p2])

    expect([r1, r2].filter((r) => r instanceof InventoryError)).toHaveLength(0)
    expect(d.etat.quantite).toBe(0)
  })

  it('la MÊME facture validée deux fois ne consomme qu’une fois', async () => {
    // Double-clic sur « Valider », ou rejeu réseau : la revendication
    // d'engagement (`stockCommittedAt: null`) doit départager.
    const d = depotPilote(5)

    const p1 = commitInvoiceStock(d.tx, { invoiceId: 'f1', garageId: GARAGE }).catch((e) => e)
    const p2 = commitInvoiceStock(d.tx, { invoiceId: 'f1', garageId: GARAGE }).catch((e) => e)
    await d.relacher()
    await Promise.all([p1, p2])

    // 5 - 1 = 4 : une seule consommation, quoi qu'il arrive.
    expect(d.etat.quantite).toBe(4)
  })
})

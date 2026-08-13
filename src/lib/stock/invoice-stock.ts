/**
 * SYNCHRONISATION FACTURE → STOCK (applicateur transactionnel).
 *
 * Contrat, volontairement étroit et explicite :
 *
 *   BROUILLON        aucun mouvement définitif (on peut saisir librement).
 *   DEVIS            aucun mouvement définitif (le lien pièce est conservé pour
 *                    la conversion, mais un devis n'engage pas l'inventaire).
 *   FACTURE VALIDÉE  décrément réel — c'est-à-dire à la SORTIE de « draft ».
 *   FACTURE MODIFIÉE seul le DELTA est appliqué (cf. lib/stock/inventory.ts).
 *   FACTURE ANNULÉE  restitution intégrale.
 *
 * Trois invariants sont tenus par construction :
 *
 * 1. ATOMICITÉ — tout passe par la transaction `tx` fournie par l'appelant. Il
 *    est impossible d'obtenir « facture validée / stock non décrémenté » ou
 *    l'inverse : la moindre erreur (stock insuffisant) lève et annule TOUT.
 *
 * 2. IDEMPOTENCE — l'engagement est revendiqué par un `updateMany` CONDITIONNEL
 *    sur `stockCommittedAt`. Deux requêtes concurrentes (double-clic sur
 *    « Valider », rejeu réseau) se disputent la même ligne : une seule voit
 *    `count === 1`, l'autre repart sans rien faire.
 *
 * 3. CONCURRENCE — chaque décrément est un `updateMany` conditionnel
 *    `quantity >= units`. Deux ventes simultanées de la dernière unité ne
 *    peuvent pas réussir toutes les deux : la seconde voit `count === 0` et
 *    échoue proprement. Aucun `lire puis écrire` non protégé.
 */

import type { PrismaClient } from '@prisma/client'
import {
  aggregateStockDemand,
  committedFromMovements,
  computeInventoryDelta,
  InventoryError,
  type InventoryLine,
} from '@/lib/stock/inventory'

/** Types de mouvements journalisés. */
export const MOVEMENT = {
  /** Sortie de stock provoquée par la validation d'une facture. */
  SALE: 'SALE',
  /** Retour en stock provoqué par l'annulation d'une facture. */
  CANCEL: 'CANCEL',
  /** Ajustement (delta) provoqué par la modification d'une facture validée. */
  ADJUST: 'ADJUST',
} as const

export type MovementType = (typeof MOVEMENT)[keyof typeof MOVEMENT]

/**
 * Sous-ensemble du client Prisma réellement utilisé. Une interface structurelle
 * (plutôt que `Prisma.TransactionClient`) permet de tester le moteur contre une
 * base simulée, exactement comme le fait déjà lib/__tests__/stock-parts.test.ts.
 */
export interface StockTxClient {
  invoice: {
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  invoiceLine: {
    findMany(args: { where: Record<string, unknown> }): Promise<InventoryLine[]>
  }
  part: {
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
    findMany(args: {
      where: Record<string, unknown>
      select?: Record<string, boolean>
    }): Promise<Array<{ id: string; name: string; quantity: number }>>
  }
  stockMovement: {
    findMany(args: {
      where: Record<string, unknown>
    }): Promise<Array<{ partId: string; quantityDelta: number }>>
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>
  }
}

export interface ReconcileResult {
  /** `false` = rien à faire (déjà dans l'état demandé) : appel idempotent. */
  changed: boolean
  /** Nombre de mouvements de stock écrits. */
  movements: number
  /** Détail `partId → unités retirées (négatif = restituées)`. */
  applied: Array<{ partId: string; units: number }>
  /**
   * Pièces qui n'existent PLUS dans le catalogue du garage : leur restitution
   * n'a pas pu être appliquée et aucun mouvement n'a pu être journalisé (la clé
   * étrangère `StockMovement.part` l'interdit). L'opération comptable n'est pas
   * bloquée pour autant — l'appelant journalise cette liste (GF31-AUD-015).
   */
  missingParts: string[]
}

const EMPTY: ReconcileResult = { changed: false, movements: 0, applied: [], missingParts: [] }

/**
 * Rapproche le stock réellement engagé par une facture avec une cible donnée.
 * Cœur unique : la validation, la modification et l'annulation ne sont que trois
 * appels avec des cibles différentes.
 */
async function reconcile(
  tx: StockTxClient,
  opts: {
    invoiceId: string
    garageId: string
    /** Lignes cibles ; `[]` pour tout restituer (annulation). */
    targetLines: InventoryLine[]
    type: MovementType
    reason: string
  },
): Promise<ReconcileResult> {
  const { invoiceId, garageId, targetLines, type, reason } = opts

  // Engagement ACTUEL, reconstitué depuis le journal (source de vérité durable :
  // il survit à une modification de lignes, contrairement aux lignes elles-mêmes).
  const movements = await tx.stockMovement.findMany({ where: { invoiceId, garageId } })
  const committed = committedFromMovements(movements)
  const target = aggregateStockDemand(targetLines)
  const deltas = computeInventoryDelta(committed, target)
  if (deltas.length === 0) return EMPTY

  // Les SORTIES d'abord : si l'une échoue pour stock insuffisant, on lève avant
  // d'avoir écrit quoi que ce soit d'autre (la transaction annule de toute façon,
  // mais l'ordre rend le diagnostic déterministe).
  const outflows = deltas.filter((d) => d.units > 0)
  const inflows = deltas.filter((d) => d.units < 0)

  for (const d of outflows) {
    // DÉCRÉMENT ATOMIQUE ET CONDITIONNEL : ne consomme que si le stock suffit.
    // C'est ici — et nulle part dans le navigateur — que la disponibilité fait
    // foi. Le stock affiché au moment de la saisie n'est jamais cru sur parole.
    const dec = await tx.part.updateMany({
      where: { id: d.partId, garageId, quantity: { gte: d.units } },
      data: { quantity: { decrement: d.units } },
    })
    if (dec.count !== 1) {
      const [part] = await tx.part.findMany({
        where: { id: d.partId, garageId },
        select: { id: true, name: true, quantity: true },
      })
      throw new InventoryError(
        409,
        part
          ? `Stock insuffisant pour « ${part.name} » : ${d.units} demandé(s), ${part.quantity} disponible(s).`
          : 'Pièce introuvable dans le stock de ce garage.',
        part ? 'INSUFFICIENT_STOCK' : 'PART_NOT_FOUND',
      )
    }
  }

  // Pièces disparues du catalogue depuis la vente : leur restitution est
  // matériellement impossible. Le commentaire d'origine annonçait justement de
  // « ne pas bloquer l'annulation pour autant » — mais le code levait, et
  // `StockMovement.part` étant en `onDelete: Cascade`, le journal de la pièce
  // avait de toute façon disparu avec elle. Conséquence : toute facture ayant
  // consommé une pièce ensuite supprimée devenait **définitivement
  // inannulable** (409 permanent), sans aucun recours (GF31-AUD-015).
  //
  // On restitue donc ce qui peut l'être, on IGNORE ce qui n'existe plus, et on
  // remonte la liste à l'appelant pour qu'il la journalise. Bloquer l'opération
  // comptable n'aurait rendu aucune unité au stock.
  const disparues: string[] = []
  for (const d of inflows) {
    const inc = await tx.part.updateMany({
      where: { id: d.partId, garageId },
      data: { quantity: { increment: -d.units } },
    })
    if (inc.count !== 1) disparues.push(d.partId)
  }

  // Aucun mouvement pour une pièce absente : la clé étrangère le refuserait.
  const ecrivables = deltas.filter((d) => !disparues.includes(d.partId))
  if (ecrivables.length > 0) {
    await tx.stockMovement.createMany({
      data: ecrivables.map((d) => ({
        garageId,
        partId: d.partId,
        type,
        // Signe côté STOCK : sortir 2 unités s'écrit −2.
        quantityDelta: -d.units,
        invoiceId,
        reason,
      })),
    })
  }

  return {
    changed: true,
    movements: ecrivables.length,
    applied: deltas.map((d) => ({ partId: d.partId, units: d.units })),
    missingParts: disparues,
  }
}

/**
 * VALIDATION d'une facture : décrémente le stock des pièces de ses lignes.
 * Idempotent — un second appel (double-clic, rejeu) ne décrémente pas deux fois.
 */
export async function commitInvoiceStock(
  tx: StockTxClient,
  opts: { invoiceId: string; garageId: string; number?: string },
): Promise<ReconcileResult> {
  // VERROU D'IDEMPOTENCE : un seul appelant peut passer `null → date`.
  const claim = await tx.invoice.updateMany({
    where: { id: opts.invoiceId, garageId: opts.garageId, stockCommittedAt: null },
    data: { stockCommittedAt: new Date() },
  })
  if (claim.count !== 1) return EMPTY

  const lines = await tx.invoiceLine.findMany({ where: { invoiceId: opts.invoiceId } })
  return reconcile(tx, {
    invoiceId: opts.invoiceId,
    garageId: opts.garageId,
    targetLines: lines,
    type: MOVEMENT.SALE,
    reason: `Facture ${opts.number ?? opts.invoiceId} validée`,
  })
}

/**
 * ANNULATION d'une facture : restitue INTÉGRALEMENT le stock qu'elle avait
 * engagé. Idempotent — annuler deux fois ne remet pas les pièces deux fois.
 */
export async function releaseInvoiceStock(
  tx: StockTxClient,
  opts: { invoiceId: string; garageId: string; number?: string; reason?: string },
): Promise<ReconcileResult> {
  const claim = await tx.invoice.updateMany({
    where: { id: opts.invoiceId, garageId: opts.garageId, stockCommittedAt: { not: null } },
    data: { stockCommittedAt: null },
  })
  if (claim.count !== 1) return EMPTY

  return reconcile(tx, {
    invoiceId: opts.invoiceId,
    garageId: opts.garageId,
    targetLines: [], // cible vide ⇒ delta = −engagé ⇒ tout revient en stock
    type: MOVEMENT.CANCEL,
    reason: opts.reason ?? `Facture ${opts.number ?? opts.invoiceId} annulée`,
  })
}

/**
 * MODIFICATION des lignes d'une facture DÉJÀ validée : n'applique que le delta.
 *
 * Note métier — les règles françaises de facturation séquentielle figent les
 * montants d'une facture émise (cf. lib/document-status.ts `areAmountsLocked`) :
 * l'API refuse donc ces modifications. Cette fonction reste le point d'entrée
 * unique si ce verrou est levé pour un cas précis (avoir, régularisation), et
 * elle garantit alors le bon comportement : 2 → 3 ne retire que 1.
 */
export async function syncInvoiceStock(
  tx: StockTxClient,
  opts: { invoiceId: string; garageId: string; number?: string },
): Promise<ReconcileResult> {
  const lines = await tx.invoiceLine.findMany({ where: { invoiceId: opts.invoiceId } })
  return reconcile(tx, {
    invoiceId: opts.invoiceId,
    garageId: opts.garageId,
    targetLines: lines,
    type: MOVEMENT.ADJUST,
    reason: `Facture ${opts.number ?? opts.invoiceId} modifiée`,
  })
}

/** Identifiants de pièces distincts référencés par un jeu de lignes saisies. */
export function collectPartIds(lines: Array<{ partId?: string | null }> | undefined): string[] {
  const ids = new Set<string>()
  for (const l of lines ?? []) {
    if (typeof l?.partId === 'string' && l.partId.length > 0) ids.add(l.partId)
  }
  return Array.from(ids)
}

/**
 * ANTI-IDOR — identifiants de pièces qui n'appartiennent PAS à ce garage
 * (ou qui n'existent pas). Le client peut envoyer n'importe quel `partId` ;
 * seul le serveur décide s'il est recevable.
 *
 * `import type` : dépendance de TYPE uniquement, effacée à la compilation — le
 * module reste utilisable avec une base simulée dans les tests.
 */
export async function findForeignPartIds(
  db: Pick<PrismaClient, 'part'>,
  garageId: string,
  partIds: string[],
): Promise<string[]> {
  if (partIds.length === 0) return []
  const owned = await db.part.findMany({
    where: { id: { in: partIds }, garageId },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((p) => p.id))
  return partIds.filter((id) => !ownedIds.has(id))
}

export { InventoryError }

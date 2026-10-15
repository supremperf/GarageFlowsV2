/**
 * MOTEUR D'INVENTAIRE — logique PURE, sans Prisma ni Next.
 *
 * Règle métier centrale (une seule, réutilisée partout) : le stock engagé par un
 * document est la SOMME, par pièce, des quantités de ses lignes rattachées à une
 * pièce du stock. Tout changement d'état d'un document se ramène alors à un
 * simple RAPPROCHEMENT :
 *
 *     delta = quantités cibles  −  quantités déjà engagées
 *
 * C'est ce calcul de DELTA qui garantit les comportements exigés :
 *   • validation d'une facture (engagé = ∅)      → delta = tout, on décrémente ;
 *   • modification 2 → 3 (engagé = 2)            → delta = 1, on décrémente 1
 *                                                  (surtout PAS 3 de nouveau) ;
 *   • modification 2 → 1                          → delta = −1, on restitue 1 ;
 *   • suppression d'une ligne / annulation        → delta = −engagé, tout revient ;
 *   • changement de pièce A→B                     → −A et +B en un seul passage.
 *
 * Les quantités de lignes sont stockées en DIX-MILLIÈMES d'unité (cf. money.ts) ;
 * le stock, lui, est un nombre ENTIER d'unités. La conversion est donc STRICTE :
 * une demi-pièce ne peut pas sortir d'un inventaire à l'unité, et le refus est
 * explicite plutôt que silencieusement arrondi.
 */

import { MONEY_SCALE } from '@/lib/money'

/** Ligne de document telle que stockée, vue « inventaire ». */
export interface InventoryLine {
  id?: string
  /** Pièce du stock rattachée ; `null`/absent = main-d'œuvre ou ligne libre. */
  partId?: string | null
  isLabor?: boolean
  description?: string
  quantityTenThousandths: number
}

/** Mouvement à appliquer sur une pièce. `units` > 0 = sortie, < 0 = restitution. */
export interface InventoryDelta {
  partId: string
  /** Nombre d'unités à RETIRER du stock (négatif = à remettre). */
  units: number
}

/** Erreur métier d'inventaire, porteuse d'un statut HTTP et d'un code stable. */
export class InventoryError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message)
    this.name = 'InventoryError'
  }
}

/**
 * Convertit une quantité de ligne (dix-millièmes d'unité) en NOMBRE ENTIER
 * d'unités de stock. Retourne `null` si la conversion n'est pas exacte ou si la
 * valeur n'est pas exploitable (NaN, Infinity, ≤ 0, fractionnaire).
 */
export function unitsFromScaledQuantity(quantityTenThousandths: number): number | null {
  const q = Number(quantityTenThousandths)
  if (!Number.isFinite(q)) return null
  if (!Number.isInteger(q)) return null
  if (q <= 0) return null
  if (q % MONEY_SCALE !== 0) return null
  const units = q / MONEY_SCALE
  // Garde-fou anti-abus, aligné sur /api/jobs/[id]/parts.
  if (units > 100_000) return null
  return units
}

/**
 * Une ligne consomme-t-elle du stock ?
 * NON pour la main-d'œuvre, NON pour une ligne libre (pas de `partId`).
 * Différencie explicitement STOCK ITEM / FREE LINE / LABOUR.
 */
export function lineConsumesStock(line: InventoryLine): boolean {
  if (line.isLabor) return false
  return typeof line.partId === 'string' && line.partId.length > 0
}

/**
 * Agrège les besoins en stock d'un jeu de lignes : `partId → unités`.
 * Deux lignes portant la même pièce sont additionnées (une facture peut lister
 * la même référence deux fois).
 *
 * @throws InventoryError si une ligne rattachée à une pièce porte une quantité
 *   inexploitable en stock (fractionnaire, nulle, négative, aberrante).
 */
export function aggregateStockDemand(lines: InventoryLine[]): Map<string, number> {
  const demand = new Map<string, number>()
  for (const line of lines ?? []) {
    if (!lineConsumesStock(line)) continue
    const units = unitsFromScaledQuantity(line.quantityTenThousandths)
    if (units === null) {
      throw new InventoryError(
        400,
        `Quantité invalide pour la pièce « ${line.description ?? line.partId} » : le stock se gère en unités entières.`,
        'INVALID_STOCK_QUANTITY',
      )
    }
    const partId = line.partId as string
    demand.set(partId, (demand.get(partId) ?? 0) + units)
  }
  return demand
}

/**
 * DELTA entre l'engagement actuel et la cible. Le résultat ne contient QUE les
 * pièces réellement impactées (delta ≠ 0) : rejouer un rapprochement identique
 * ne produit aucun mouvement, ce qui rend l'opération naturellement idempotente.
 *
 * @param committed pièces déjà sorties du stock pour ce document (unités > 0)
 * @param target    pièces qui devraient l'être après l'opération
 */
export function computeInventoryDelta(
  committed: Map<string, number>,
  target: Map<string, number>,
): InventoryDelta[] {
  const partIds = new Set<string>(Array.from(committed.keys()).concat(Array.from(target.keys())))
  const deltas: InventoryDelta[] = []
  // Tri stable : ordre déterministe des mouvements et des verrous de ligne
  // (deux transactions concurrentes prennent les pièces dans le MÊME ordre, ce
  // qui écarte l'interblocage croisé A→B / B→A).
  for (const partId of Array.from(partIds).sort()) {
    const units = (target.get(partId) ?? 0) - (committed.get(partId) ?? 0)
    if (units !== 0) deltas.push({ partId, units })
  }
  return deltas
}

/**
 * Reconstitue l'engagement d'un document à partir de son journal de mouvements.
 * Un mouvement porte un delta SIGNÉ côté stock (−2 = deux unités sorties) ; les
 * unités engagées sont donc l'opposé de la somme. Les pièces revenues à zéro
 * sont omises.
 */
export function committedFromMovements(
  movements: Array<{ partId: string; quantityDelta: number }>,
): Map<string, number> {
  const committed = new Map<string, number>()
  for (const m of movements ?? []) {
    const engaged = (committed.get(m.partId) ?? 0) - m.quantityDelta
    committed.set(m.partId, engaged)
  }
  for (const [partId, units] of Array.from(committed.entries())) {
    if (units === 0) committed.delete(partId)
  }
  return committed
}

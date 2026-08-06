/**
 * Frontière base ⇄ application pour les unités monétaires EXACTES.
 *
 * STOCKAGE (unique source de vérité) :
 *   - prix/coûts unitaires, taux horaires/journaliers : entiers en DIX-MILLIÈMES
 *     d'euro (`*TenThousandths`, voir lib/money.ts MONEY_SCALE) ;
 *   - quantités fractionnaires : entiers en DIX-MILLIÈMES d'unité ;
 *   - totaux/soldes/cautions : entiers en CENTIMES (`*Cents`).
 *
 * CONTRAT D'API : les réponses JSON exposent LES DEUX représentations —
 * les entiers exacts (source de vérité, aucune perte JSON) ET les nombres
 * dérivés (`unitPrice`, `quantity`, … en euros/unités) pour l'affichage et la
 * compatibilité des composants. La dérivation `scaled/10000` est une division
 * IEEE correctement arrondie : elle redonne EXACTEMENT le même double que la
 * saisie d'origine (ex. 199900/10000 === 19.99), ce qui préserve à l'identique
 * les documents SIGNÉS (canonicalisation en euros) et les PDF/exports.
 *
 * ÉCRITURE : les saisies (euros/quantités, nombre ou chaîne validée) sont
 * converties en entiers exacts via `toScaled`/`parseAmountToScaled` — jamais de
 * Number() silencieux dans un chemin financier.
 */

import { fromScaled, toScaled, fromCents, lineTotalCentsFromScaled, MONEY_SCALE } from '@/lib/money'

/**
 * Vue « facturation » de lignes partiellement sélectionnées (quantité + prix) :
 * dérive les euros/unités des entiers exacts pour calcTotalHT/TTC & co.
 */
export function billingLines(
  lines: Array<{ quantityTenThousandths: number; unitPriceTenThousandths: number }>,
): Array<{ quantity: number; unitPrice: number }> {
  return (lines ?? []).map((l) => ({
    quantity: fromScaled(l.quantityTenThousandths),
    unitPrice: fromScaled(l.unitPriceTenThousandths),
  }))
}

/** Idem avec le coût (marges) : {quantity, unitPrice, unitCost} en euros/unités. */
export function costedLines(
  lines: Array<{
    quantityTenThousandths: number
    unitPriceTenThousandths: number
    unitCostTenThousandths: number
  }>,
): Array<{ quantity: number; unitPrice: number; unitCost: number }> {
  return (lines ?? []).map((l) => ({
    quantity: fromScaled(l.quantityTenThousandths),
    unitPrice: fromScaled(l.unitPriceTenThousandths),
    unitCost: fromScaled(l.unitCostTenThousandths),
  }))
}

/**
 * Montant en CENTIMES d'une ligne à quantité ENTIÈRE (ex. JobPart.quantity Int) :
 * prix exact (dix-millièmes) × quantité entière, arrondi une fois au centime.
 */
export function intQtyLineCents(unitScaled: number, qtyUnits: number): number {
  return lineTotalCentsFromScaled(unitScaled, (qtyUnits ?? 0) * MONEY_SCALE)
}

/** Ligne stockée (devis/facture) — champs exacts. */
export interface ScaledLine {
  quantityTenThousandths: number
  unitPriceTenThousandths: number
  unitCostTenThousandths: number
}

/** Vue applicative d'une ligne : champs exacts + dérivés euros/unités. */
export type LineWithEuros<T extends ScaledLine> = T & {
  quantity: number
  unitPrice: number
  unitCost: number
}

/** Ajoute les dérivés euros/unités à une ligne stockée (spread non mutant). */
export function lineToEuros<T extends ScaledLine>(l: T): LineWithEuros<T> {
  return {
    ...l,
    quantity: fromScaled(l.quantityTenThousandths),
    unitPrice: fromScaled(l.unitPriceTenThousandths),
    unitCost: fromScaled(l.unitCostTenThousandths),
  }
}

export function linesToEuros<T extends ScaledLine>(lines: T[]): LineWithEuros<T>[] {
  return (lines ?? []).map(lineToEuros)
}

/** Convertit une saisie de ligne (euros/unités) vers les champs stockés exacts. */
export function lineToScaled(l: { quantity?: number; unitPrice?: number; unitCost?: number }): {
  quantityTenThousandths: number
  unitPriceTenThousandths: number
  unitCostTenThousandths: number
} {
  return {
    quantityTenThousandths: toScaled(l.quantity ?? 1),
    unitPriceTenThousandths: toScaled(l.unitPrice ?? 0),
    unitCostTenThousandths: toScaled(l.unitCost ?? 0),
  }
}

/** Pièce de stock : dérive unitCost/unitPrice (euros) des entiers exacts. */
export function partToEuros<T extends { unitCostTenThousandths: number; unitPriceTenThousandths: number }>(
  p: T,
): T & { unitCost: number; unitPrice: number } {
  return {
    ...p,
    unitCost: fromScaled(p.unitCostTenThousandths),
    unitPrice: fromScaled(p.unitPriceTenThousandths),
  }
}

/** JobPart (snapshot) : dérive unitPrice/unitCost (euros). */
export function jobPartToEuros<T extends { unitPriceTenThousandths: number; unitCostTenThousandths: number }>(
  jp: T,
): T & { unitPrice: number; unitCost: number } {
  return {
    ...jp,
    unitPrice: fromScaled(jp.unitPriceTenThousandths),
    unitCost: fromScaled(jp.unitCostTenThousandths),
  }
}

/** Garage : dérive hourlyRate (€/h) de l'entier exact. */
export function garageToEuros<T extends { hourlyRateTenThousandths: number }>(
  g: T,
): T & { hourlyRate: number } {
  return { ...g, hourlyRate: fromScaled(g.hourlyRateTenThousandths) }
}

/** Opération de main-d'œuvre : dérive unitPrice (€) de l'entier exact. */
export function laborOpToEuros<T extends { unitPriceTenThousandths: number }>(
  op: T,
): T & { unitPrice: number } {
  return { ...op, unitPrice: fromScaled(op.unitPriceTenThousandths) }
}

/** Réservation de prêt : dérive dailyRate (€/j) + depositAmount (€). */
export function loanerToEuros<T extends { dailyRateTenThousandths: number | null; depositAmountCents: number | null }>(
  r: T,
): T & { dailyRate: number | null; depositAmount: number | null } {
  return {
    ...r,
    dailyRate: r.dailyRateTenThousandths == null ? null : fromScaled(r.dailyRateTenThousandths),
    depositAmount: r.depositAmountCents == null ? null : fromCents(r.depositAmountCents),
  }
}

/** Ordre de réparation : dérive totalHT/totalTTC (€) des centimes. */
export function workOrderToEuros<T extends { totalHtCents: number; totalTtcCents: number }>(
  wo: T,
): T & { totalHT: number; totalTTC: number } {
  return { ...wo, totalHT: fromCents(wo.totalHtCents), totalTTC: fromCents(wo.totalTtcCents) }
}

/** Bon de commande : dérive totalHT (€) des centimes. */
export function purchaseOrderToEuros<T extends { totalHtCents: number }>(
  po: T,
): T & { totalHT: number } {
  return { ...po, totalHT: fromCents(po.totalHtCents) }
}

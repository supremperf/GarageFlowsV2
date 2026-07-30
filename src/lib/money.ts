/**
 * Couche monétaire centralisée — tous les calculs financiers se font en ENTIERS
 * de centimes, jamais en flottants JavaScript.
 *
 * Pourquoi : `0.1 + 0.2 !== 0.3` en IEEE-754. Accumuler des prix en flottants
 * introduit des erreurs qui faussent totaux, TVA et soldes. En travaillant en
 * centimes entiers, l'addition est EXACTE et l'arrondi est explicite et unique.
 *
 * Règles :
 *  - montant € ⇄ centimes via `toCents` / `fromCents` (arrondi bancaire au plus
 *    proche, demi vers le haut) ;
 *  - une ligne = round(quantité × prixUnitaire_centimes) ;
 *  - TVA = round(HT_centimes × taux / 100) ;
 *  - INVARIANT garanti : totalTTC = totalHT + TVA (en centimes, donc exact).
 */

/** Arrondi au centime le plus proche (demi vers le haut), robuste au bruit float. */
export function toCents(amountEuros: number): number {
  if (!Number.isFinite(amountEuros)) return 0
  // Le +epsilon corrige le bruit binaire (ex. 1.005 * 100 = 100.49999…).
  return Math.round((amountEuros + Number.EPSILON) * 100)
}

/** Convertit des centimes entiers en euros (2 décimales exactes). */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** Multiplie un montant (centimes) par une quantité (potentiellement décimale). */
export function multiplyCents(cents: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0
  return Math.round(cents * quantity)
}

export interface MoneyLine {
  quantity: number
  /** Prix unitaire en EUROS (converti en centimes en interne). */
  unitPrice: number
}

export interface Totals {
  totalHTCents: number
  taxCents: number
  totalTTCCents: number
  totalHT: number
  taxAmount: number
  totalTTC: number
}

/**
 * Calcule les totaux d'un ensemble de lignes pour un taux de TVA (ex. 20 = 20 %).
 * Tout se fait en centimes entiers ; les euros retournés en sont dérivés.
 * Garantit totalTTC = totalHT + TVA (aucune dérive de centime).
 */
export function computeTotals(lines: MoneyLine[], taxRatePercent: number): Totals {
  const rate = Number.isFinite(taxRatePercent) ? taxRatePercent : 0
  let totalHTCents = 0
  for (const l of lines ?? []) {
    totalHTCents += multiplyCents(toCents(l.unitPrice), l.quantity ?? 0)
  }
  const taxCents = Math.round((totalHTCents * rate) / 100)
  const totalTTCCents = totalHTCents + taxCents
  return {
    totalHTCents,
    taxCents,
    totalTTCCents,
    totalHT: fromCents(totalHTCents),
    taxAmount: fromCents(taxCents),
    totalTTC: fromCents(totalTTCCents),
  }
}

/** Applique une remise (pourcentage puis montant fixe) à un total en centimes. */
export function applyDiscountCents(
  baseCents: number,
  opts: { percent?: number; fixedEuros?: number },
): number {
  let cents = baseCents
  if (opts.percent && Number.isFinite(opts.percent)) {
    cents = cents - Math.round((cents * opts.percent) / 100)
  }
  if (opts.fixedEuros && Number.isFinite(opts.fixedEuros)) {
    cents = cents - toCents(opts.fixedEuros)
  }
  return Math.max(0, cents)
}

/**
 * Solde restant dû d'une facture, en centimes puis euros. Exact :
 * solde = totalTTC − paiements − avoirs.
 */
export function balanceCents(totalTTCCents: number, paymentsEuros: number[] = [], creditsEuros: number[] = []): number {
  const paid = paymentsEuros.reduce((s, p) => s + toCents(p), 0)
  const credited = creditsEuros.reduce((s, c) => s + toCents(c), 0)
  return totalTTCCents - paid - credited
}

/** Formate un montant en euros pour l'affichage (fr-FR). */
export function formatEuros(amountEuros: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amountEuros)
  } catch {
    return `${fromCents(toCents(amountEuros)).toFixed(2)} €`
  }
}

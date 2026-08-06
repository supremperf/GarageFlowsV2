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

/**
 * Arrondi au centime le plus proche, SYMÉTRIQUE (demi éloigné de zéro), robuste
 * au bruit float. Le calcul se fait sur la valeur absolue puis on réapplique le
 * signe : ainsi les avoirs/remboursements (montants négatifs) sont arrondis de
 * façon miroir aux montants positifs (−1,005 € → −1,01 €, comme +1,005 € →
 * +1,01 €) — évite l'asymétrie de Math.round qui arrondit −100,5 vers −100.
 * (Fusion : intègre le correctif d'arrondi des montants négatifs de la branche
 * complete-platform tout en conservant la couche centimes exacte du socle.)
 */
/**
 * Arrondi demi-éloigné-de-zéro d'une valeur DÉJÀ exprimée en centimes (possib-
 * lement fractionnaire). Symétrique par construction : round(|n|) puis signe.
 * Math.round natif est asymétrique sur les demis négatifs (Math.round(-0.5) =
 * -0), ce qui réintroduisait une dérive de 1 c sur les avoirs/retours.
 */
function roundHalfAwayFromZero(n: number): number {
  return (n < 0 ? -1 : 1) * Math.round(Math.abs(n))
}

export function toCents(amountEuros: number): number {
  if (!Number.isFinite(amountEuros)) return 0
  const sign = amountEuros < 0 ? -1 : 1
  // Arrondi demi-éloigné-de-zéro À L'ÉCHELLE DU CENTIME, robuste au bruit
  // IEEE-754 à TOUTES les magnitudes. Un Number.EPSILON fixe ajouté aux EUROS
  // ne corrigeait que la plage [1,2) (l'ULP dépasse EPSILON au-delà) : 9,995 €
  // donnait 999 c au lieu de 1000. Ici la tolérance (1e-7 centime) est ajoutée
  // APRÈS passage en centimes : ≫ ULP pour tout montant réaliste (< 1e7 €) mais
  // ≪ un demi-centime, donc elle n'absorbe que le bruit binaire (1,005 → 101).
  return sign * Math.round(Math.abs(amountEuros) * 100 + 1e-7)
}

/** Convertit des centimes entiers en euros (2 décimales exactes). */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** Multiplie un montant (centimes) par une quantité (potentiellement décimale). */
export function multiplyCents(cents: number, quantity: number): number {
  if (!Number.isFinite(quantity)) return 0
  // Arrondi symétrique : une ligne d'avoir (montant/quantité négatif) doit être
  // le miroir exact de la ligne de vente (Math.round(-499.5) = -499 cassait la
  // symétrie garantie par toCents → résidu de 1 c sur les avoirs).
  return roundHalfAwayFromZero(cents * quantity)
}

/**
 * Montant d'UNE ligne, en centimes : `round(prix_unitaire_€ × quantité)`.
 *
 * PRÉCISION 4 DÉCIMALES : le prix unitaire N'EST PAS arrondi au centime avant la
 * multiplication. Le produit `prix × quantité` (précision étendue) est arrondi au
 * centime UNE SEULE FOIS, à la fin. Ainsi 12,3456 € × 3 = 37,0368 € → 37,04 €
 * (et non 12,35 € × 3 = 37,05 €). L'ancien `multiplyCents(toCents(prix), qté)`
 * arrondissait le prix trop tôt et faussait les prix à 3-4 décimales.
 * Arrondi demi-éloigné-de-zéro (symétrique) → une ligne d'avoir est le miroir exact.
 */
export function lineCents(unitPriceEuros: number, quantity: number): number {
  if (!Number.isFinite(unitPriceEuros) || !Number.isFinite(quantity)) return 0
  return toCents(unitPriceEuros * quantity)
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
    // Arrondi de la ligne sur le MONTANT ÉTENDU (prix×qté), pas sur le prix seul :
    // préserve la précision 4 décimales du prix unitaire (voir lineCents).
    totalHTCents += lineCents(l.unitPrice, l.quantity ?? 0)
  }
  const taxCents = roundHalfAwayFromZero((totalHTCents * rate) / 100)
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

/**
 * Marge en centimes = produit − coût (soustraction d'entiers, donc EXACTE).
 * Les montants négatifs (coût supérieur au produit) sont conservés tels quels —
 * une marge négative est une information métier valide, jamais tronquée à zéro.
 */
export function marginCents(revenueCents: number, costCents: number): number {
  return Math.round(revenueCents) - Math.round(costCents)
}

/** Ligne avec coût d'achat optionnel, pour le calcul de marge en centimes. */
export interface CostedLine {
  quantity: number
  /** Prix de vente unitaire en EUROS. */
  unitPrice: number
  /** Coût d'achat unitaire en EUROS (0 si absent). */
  unitCost?: number
}

/**
 * Produit, coût et marge d'un ensemble de lignes, TOUT en centimes entiers.
 * Même convention d'arrondi que `computeTotals` : arrondi PAR LIGNE
 * (`round(quantité × prix_centimes)`), jamais d'accumulation flottante. Utilisable
 * partout où l'on calculait une marge en `number` natif (analytics, rentabilité).
 */
export function computeMarginCents(lines: CostedLine[]): {
  revenueCents: number
  costCents: number
  marginCents: number
} {
  let revenueCents = 0
  let costCents = 0
  for (const l of lines ?? []) {
    const qty = l.quantity ?? 0
    // Montant étendu arrondi une fois (précision 4 décimales préservée).
    revenueCents += lineCents(l.unitPrice, qty)
    costCents += lineCents(l.unitCost ?? 0, qty)
  }
  return { revenueCents, costCents, marginCents: revenueCents - costCents }
}

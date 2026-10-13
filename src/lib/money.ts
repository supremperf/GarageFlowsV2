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

/**
 * TVA en centimes pour une assiette en centimes et un taux en pourcent
 * (ex. 20 = 20 %). Arrondi fiscal demi-éloigné-de-zéro, appliqué UNE fois sur
 * l'assiette totale du taux (pas ligne à ligne). Unique formule de TVA du
 * dépôt : computeTotals et la facturation électronique s'appuient dessus —
 * toute divergence de calcul entre les deux est impossible par construction.
 *
 * Chemin 100 % ENTIER : le taux est figé en CENTIÈMES DE POINT (2 décimales,
 * comme sur les documents), puis TVA = assiette × tauxCentièmes / 10000 avec
 * détection exacte du demi (reste ≥ 5000). Corrige le bruit IEEE-754 de la
 * formule flottante historique (ex. 5500 c × 0,7 % = 38,50 c → 39 c, que le
 * produit flottant 38.4999… arrondissait à 38 — défaut démontré en revue).
 */
export function taxCentsFromBasis(basisCents: number, taxRatePercent: number): number {
  const rate = Number.isFinite(taxRatePercent) ? taxRatePercent : 0
  const basis = Math.round(basisCents)
  // Taux en centièmes de point, entier (20 % → 2000 ; 5,5 % → 550 ; 0,7 % → 70).
  const rateHundredths = Math.round(Math.abs(rate) * 100) * (rate < 0 ? -1 : 1)
  const product = basis * rateHundredths
  if (!Number.isSafeInteger(product)) {
    // Bornes extrêmes : exactitude garantie par BigInt (même règle d'arrondi).
    const p = BigInt(basis) * BigInt(rateHundredths)
    const neg = p < BigInt(0)
    const abs = neg ? -p : p
    const q = abs / BigInt(10_000)
    const r = abs - q * BigInt(10_000)
    const rounded = r >= BigInt(5_000) ? q + BigInt(1) : q
    return Number(neg ? -rounded : rounded)
  }
  const neg = product < 0
  const abs = Math.abs(product)
  const q = Math.trunc(abs / 10_000)
  const r = abs - q * 10_000
  const rounded = r >= 5_000 ? q + 1 : q
  return neg ? -rounded : rounded
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
  const taxCents = taxCentsFromBasis(totalHTCents, rate)
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

// ─── Unités EXACTES à l'échelle 1/10 000 (dix-millièmes) ─────────────────────
//
// STOCKAGE : les prix/coûts unitaires, taux horaires/journaliers et quantités
// fractionnaires sont persistés en ENTIERS de dix-millièmes (« TenThousandths »).
//   12,3456 €  → 123456    (dix-millièmes d'euro)
//   1,5 (qté)  → 15000     (dix-millièmes d'unité)
// Cette représentation est EXACTE, identique sur SQLite et PostgreSQL (INTEGER),
// et conserve les 4 décimales jusqu'à l'arrondi final au centime.

/** Facteur d'échelle des unités exactes (dix-millièmes). */
export const MONEY_SCALE = 10_000

/** Plage sûre d'un INTEGER 32 bits (colonnes Prisma Int). */
export const MAX_SCALED = 2_147_483_647

/**
 * Convertit une valeur en euros (ou une quantité) vers l'entier en dix-millièmes.
 * Arrondi demi-éloigné-de-zéro à 1e-4, robuste au bruit binaire (même stratégie
 * que toCents). Renvoie 0 pour une entrée non finie.
 */
export function toScaled(value: number): number {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  return sign * Math.round(Math.abs(value) * MONEY_SCALE + 1e-5)
}

/** Convertit un entier en dix-millièmes vers le nombre (euros / quantité).
 *  Division IEEE correctement arrondie → même double que la saisie d'origine. */
export function fromScaled(scaled: number): number {
  return Math.round(scaled) / MONEY_SCALE
}

/**
 * Montant d'une ligne en CENTIMES à partir des représentations EXACTES :
 * prix (dix-millièmes d'euro) × quantité (dix-millièmes d'unité).
 * Chemin 100 % entier : produit en 1e-8 €, arrondi une seule fois au centime
 * (demi-éloigné-de-zéro). Le produit est gardé sous 2^53 (exactitude garantie) —
 * au-delà des bornes métier (MAX_SCALED), l'entrée est invalide → 0.
 */
export function lineTotalCentsFromScaled(unitScaled: number, qtyScaled: number): number {
  if (!Number.isFinite(unitScaled) || !Number.isFinite(qtyScaled)) return 0
  if (Math.abs(unitScaled) > MAX_SCALED || Math.abs(qtyScaled) > MAX_SCALED) return 0
  const product = unitScaled * qtyScaled // 1e-8 € ; |produit| < 2^53 non garanti aux extrêmes
  if (!Number.isSafeInteger(product)) {
    // Repli exact : produit BigInt et arrondi demi-éloigné-de-zéro UNIQUE sur le
    // total (l'ancienne décomposition entier+reste arrondissait DEUX fois et
    // dérivait de ±1 c — défaut démontré en revue adversariale).
    const p = BigInt(unitScaled) * BigInt(qtyScaled)
    const neg = p < BigInt(0)
    const abs = neg ? -p : p
    const q = abs / BigInt(1_000_000)
    const r = abs - q * BigInt(1_000_000)
    const rounded = r >= BigInt(500_000) ? q + BigInt(1) : q
    return Number(neg ? -rounded : rounded)
  }
  return roundHalfAwayFromZero(product / 1_000_000)
}

/**
 * Parsing STRICT d'une saisie décimale (formulaire) vers l'entier en
 * dix-millièmes. Accepte chaîne (virgule OU point) ou nombre fini.
 * Rejette (→ null) : NaN, Infinity, notation exotique, plus de `maxDecimals`
 * décimales, hors plage Int32. Ne passe JAMAIS par un Number() silencieux :
 * la chaîne est validée par motif puis convertie exactement.
 */
export function parseAmountToScaled(
  input: string | number,
  opts: { maxDecimals?: number; allowNegative?: boolean } = {},
): number | null {
  const maxDecimals = opts.maxDecimals ?? 4
  let str: string
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    str = String(input)
    if (!/^[+-]?\d+(\.\d+)?$/.test(str)) return null // notation exponentielle → rejet
  } else {
    str = input.trim().replace(',', '.')
  }
  const m = str.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  const [, sign, intPart, decPart = ''] = m
  if (decPart.length > maxDecimals) return null
  if (sign === '-' && opts.allowNegative === false) return null
  const scaled =
    (sign === '-' ? -1 : 1) *
    (Number(intPart) * MONEY_SCALE + Number((decPart + '0000').slice(0, 4)))
  if (!Number.isSafeInteger(scaled) || Math.abs(scaled) > MAX_SCALED) return null
  return scaled
}

/**
 * Répartit un total en centimes entre plusieurs lignes au prorata de poids,
 * SANS perdre ni créer un centime : la somme des parts vaut exactement le total
 * (méthode du plus fort reste). Poids nuls/négatifs → répartition égale.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const sum = safe.reduce((s, w) => s + w, 0)
  const base = sum > 0 ? safe : safe.map(() => 1)
  const baseSum = sum > 0 ? sum : n
  const raw = base.map((w) => (totalCents * w) / baseSum)
  const floors = raw.map((r) => Math.trunc(r))
  let remainder = totalCents - floors.reduce((s, f) => s + f, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
    .sort((a, b) => b.frac - a.frac)
  const out = [...floors]
  const step = remainder >= 0 ? 1 : -1
  for (let k = 0; remainder !== 0 && k < order.length; k++, remainder -= step) {
    out[order[k].i] += step
  }
  return out
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

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

/**
 * Arrondi d'affichage au centime, SANS zéro signé.
 *
 * `Math.round(-0.004 * 100) / 100` vaut `-0` en IEEE-754, et `(-0).toFixed(2)`
 * rend « 0.00 » — mais tout code qui préfixe le signe lui-même (`-${v.toFixed(2)}`,
 * ou `v >= 0 ? '+' : '-'`) réintroduit le signe et affiche « -0.00 € ».
 * On normalise donc -0 → 0 ici, une seule fois.
 */
export function roundEurosForDisplay(value: number): number {
  // Même arrondi que le reste du module (demi-éloigné-de-zéro, robuste au bruit
  // binaire) : l'affichage ne doit pas diverger du montant réellement stocké.
  const r = fromCents(toCents(value))
  return Object.is(r, -0) ? 0 : r
}

/** Politique de signe d'un montant affiché. */
export type MoneySign =
  /** « + » seulement si strictement positif après arrondi (défaut). */
  | 'auto'
  /** « + » / « - » toujours affiché (sauf zéro). */
  | 'always'
  /** Poste de coût : toujours rendu négatif (sauf zéro). */
  | 'negative'

/**
 * Montant en euros prêt à afficher (« 12.30 € », « +12.30 € », « -12.30 € »).
 *
 * Le signe est décidé APRÈS l'arrondi au centime : un montant nul — ou qui
 * s'arrondit à zéro — s'affiche toujours « 0.00 € », jamais « -0.00 € » ni
 * « +0.00 € ». C'est la cause racine du « -0.00 € » observé sur la carte
 * rentabilité (coût pièces = 0 avec un « - » codé en dur dans le template).
 */
export function formatEuros(value: number, sign: MoneySign = 'auto'): string {
  const r = roundEurosForDisplay(value)
  const abs = Math.abs(r).toFixed(2)
  if (r === 0) return `${abs} €`
  if (sign === 'negative') return `-${abs} €`
  if (sign === 'always') return `${r > 0 ? '+' : '-'}${abs} €`
  return `${r < 0 ? '-' : ''}${abs} €`
}

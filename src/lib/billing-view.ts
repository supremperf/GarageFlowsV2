/**
 * Helpers d'AFFICHAGE facturation/devis — purs & robustes aux données réelles.
 *
 * Cause racine des crashes « Une erreur est survenue » sur Factures/Devis :
 *  1. une réponse API inattendue (objet d'erreur, null, {data:[...]}) stockée telle
 *     quelle → `docs.filter`/`docs.reduce` jette « x is not a function » ;
 *  2. un document LEGACY avec un champ null (ex. `number`) → `d.number.toLowerCase()`
 *     jette « Cannot read properties of null » ;
 *  3. un montant non fini (NaN/undefined/chaîne) → `.toFixed()` produit « NaN » ou
 *     jette si ce n'est pas un nombre.
 * Ces fonctions neutralisent ces cas SANS masquer de vraie erreur métier : elles
 * ne changent que la robustesse d'affichage (aucune donnée n'est inventée).
 */

export interface BillingDocLike {
  number?: string | null
  status?: string | null
  totalTTC?: unknown
  totalHT?: unknown
  clientName?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
  job?: { customerName?: string | null; vehicleModel?: string | null; licensePlate?: string | null } | null
}

/**
 * Normalise une réponse API en TABLEAU. Accepte un tableau nu, un enveloppe
 * `{ data: [...] }`, ou renvoie `[]` pour toute autre forme (objet d'erreur,
 * null, undefined, nombre…). Empêche tout crash `filter/reduce/map` en aval.
 */
export function asDocArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: T[] }).data
  }
  return []
}

/** Montant sûr pour affichage : nombre FINI, sinon 0 (jamais NaN/undefined/chaîne). */
export function safeAmount(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Formate un montant en chaîne à N décimales, robuste (safeAmount d'abord). */
export function formatAmount(x: unknown, digits = 2): string {
  return safeAmount(x).toFixed(digits)
}

/** Prédicat de recherche robuste aux champs null/legacy. */
export function docMatchesSearch(d: BillingDocLike, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  const fields = [
    d.number ?? '',
    d.job?.customerName ?? d.clientName ?? '',
    d.job?.vehicleModel ?? d.vehicleModel ?? '',
    d.job?.licensePlate ?? d.licensePlate ?? '',
  ]
  return fields.some((f) => String(f).toLowerCase().includes(q))
}

/** Somme TTC robuste (montants non finis comptés comme 0). */
export function sumTTC(docs: BillingDocLike[]): number {
  return asDocArray<BillingDocLike>(docs).reduce((s, d) => s + safeAmount(d.totalTTC), 0)
}

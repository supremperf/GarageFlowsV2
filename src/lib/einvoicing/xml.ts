/**
 * Aides XML sans dépendance externe (préserve la propreté PI/SBOM).
 * Échappement conforme + formatage monétaire EXACT depuis des centimes entiers
 * (jamais de flottant : évite « 123.45000000001 »).
 */

/** Échappe les caractères XML dans le contenu texte. */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Formate des centimes entiers en décimale à 2 chiffres, sans passer par un flottant. */
export function formatCents(cents: number): string {
  const n = Math.round(cents)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

/** Formate une quantité (potentiellement décimale) avec au plus 4 décimales, sans zéros superflus. */
export function formatQuantity(q: number): string {
  if (!Number.isFinite(q)) return '0'
  const rounded = Math.round(q * 10000) / 10000
  return String(rounded)
}

/** Date ISO `YYYY-MM-DD` → format Factur-X 102 `YYYYMMDD`. */
export function toFacturXDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[1]}${m[2]}${m[3]}` : ''
}

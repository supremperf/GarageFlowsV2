/**
 * Thème d'IMPRESSION du contrôle véhicule — indépendant du thème de l'écran.
 *
 * L'interface de GarageFlows est sombre ; le PDF doit être un document sur fond
 * blanc. Réutiliser les teintes de l'écran (ou les nuances Tailwind `-50`, quasi
 * blanches) donnait le rendu « extrêmement pâle » signalé.
 *
 * Contraintes tenues ici, vérifiées par les tests :
 *   - couleurs OPAQUES uniquement (pas de `rgba(…, .1)`, pas d'`opacity`) : une
 *     couleur alpha se compose avec le fond et délave le rendu ;
 *   - contraste du texte sur blanc ≥ 4,5:1 (seuil WCAG AA) ;
 *   - chaque état porte AUSSI un pictogramme et un libellé, jamais la couleur
 *     seule — le document reste lisible imprimé en noir et blanc.
 */

/** Texte principal — quasi noir. */
export const INK = '#111827'
/** Texte secondaire. */
export const INK_SOFT = '#374151'
/** Libellés de champs. */
export const INK_MUTED = '#4b5563'
/** Filets et bordures. */
export const RULE = '#9ca3af'
export const RULE_LIGHT = '#d1d5db'
export const PAPER = '#ffffff'

export type InspectionStatus = 'ok' | 'warning' | 'critical' | 'na'

export interface StatusStyle {
  /** Pictogramme — l'information ne dépend jamais de la seule couleur. */
  mark: string
  label: string
  /** Couleur du texte d'état (sur fond blanc). */
  color: string
  /** Bande latérale de repérage. */
  band: string
}

export const STATUS_STYLES: Record<InspectionStatus, StatusStyle> = {
  ok:       { mark: '✔', label: 'Conforme',     color: '#065f46', band: '#d1fae5' },
  warning:  { mark: '!', label: 'À surveiller', color: '#92400e', band: '#fde68a' },
  critical: { mark: '✖', label: 'Critique',     color: '#991b1b', band: '#fecaca' },
  na:       { mark: '–', label: 'Non contrôlé', color: '#374151', band: '#e5e7eb' },
}

/** Ordre d'affichage : le plus grave d'abord. */
export const STATUS_ORDER: InspectionStatus[] = ['critical', 'warning', 'ok', 'na']

/** Composante linéarisée d'un canal sRGB (formule WCAG). */
function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Luminance relative d'une couleur `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Couleur d'impression invalide (attendu #rrggbb) : ${hex}`)
  const n = parseInt(m[1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** Rapport de contraste WCAG entre deux couleurs opaques (1 → 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

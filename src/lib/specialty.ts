/**
 * "specialty" d'un mécanicien : stockée en base comme une CHAÎNE JSON d'un
 * tableau de strings (colonne Mechanic.specialty, défaut '[]').
 *
 * Ces helpers garantissent qu'on n'écrit JAMAIS une valeur non-JSON en base et
 * qu'on ne LÈVE JAMAIS à la lecture (un JSON.parse non gardé sur une ligne
 * corrompue faisait planter toute la route /api/suggestions pour le garage).
 */

/** Parse une specialty (brute ou stockée) en tableau de strings — sans jamais lever. */
export function parseSpecialty(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((x): x is string => typeof x === 'string')
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

/** Normalise n'importe quelle entrée en chaîne JSON d'un tableau de strings (pour l'écriture). */
export function normalizeSpecialty(input: unknown): string {
  return JSON.stringify(parseSpecialty(input))
}

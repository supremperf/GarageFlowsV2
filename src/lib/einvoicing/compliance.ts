/**
 * Niveaux de conformité de la facturation électronique — communication HONNÊTE.
 *
 * L'objectif est d'interdire structurellement toute sur-affirmation : le code
 * expose un NIVEAU de conformité explicite et un scanner de formulations
 * interdites. Le niveau réel actuel est `INTERNAL_SANDBOX_ONLY` : le module
 * produit/valide des documents (cœur EN 16931) et les transmet à un fournisseur
 * SIMULÉ. Aucune plateforme agréée (PDP) réelle n'est intégrée.
 *
 * Ne JAMAIS affirmer « certifié conforme » ou « PDP intégré » tant qu'une
 * intégration officielle n'est pas réellement opérationnelle et prouvée.
 */

/** Progression, du moins avancé au plus avancé. Ordre significatif. */
export const COMPLIANCE_LEVELS = [
  'INTERNAL_SANDBOX_ONLY',   // fournisseur simulé interne (état actuel)
  'EXTERNAL_SANDBOX_TESTED', // sandbox d'une PDP réelle, testée
  'PILOT_WITH_PDP',          // pilote en production limitée avec une PDP agréée
  'PRODUCTION_VALIDATED',    // production validée, preuves d'interopérabilité
] as const

export type ComplianceLevel = (typeof COMPLIANCE_LEVELS)[number]

/** Niveau réel courant — à ne relever que sur preuve d'intégration réelle. */
export const CURRENT_COMPLIANCE_LEVEL: ComplianceLevel = 'INTERNAL_SANDBOX_ONLY'

/** Énoncé honnête associé à chaque niveau (affichable UI/API). */
export const COMPLIANCE_STATEMENTS: Record<ComplianceLevel, string> = {
  INTERNAL_SANDBOX_ONLY:
    'Documents conformes au cœur EN 16931 transmis à un fournisseur SIMULÉ (sandbox interne). Aucune plateforme agréée (PDP) intégrée. Non utilisable pour une transmission légale réelle.',
  EXTERNAL_SANDBOX_TESTED:
    'Interopérabilité testée avec la sandbox d’une PDP réelle. Pas encore de transmission en production.',
  PILOT_WITH_PDP:
    'Pilote en production limitée avec une PDP agréée. Périmètre et volumes restreints, sous supervision.',
  PRODUCTION_VALIDATED:
    'Transmission en production validée avec une PDP agréée, preuves d’interopérabilité disponibles.',
}

/** Rang numérique d'un niveau (pour comparaisons). */
export function complianceRank(level: ComplianceLevel): number {
  return COMPLIANCE_LEVELS.indexOf(level)
}

/** L'énoncé honnête du niveau courant. */
export function currentComplianceStatement(): string {
  return COMPLIANCE_STATEMENTS[CURRENT_COMPLIANCE_LEVEL]
}

/**
 * Vrai UNIQUEMENT si le niveau atteint la validation en production. Sert de
 * garde-fou : toute UI/communication qui prétend « conforme/production » doit
 * passer par ce test, jamais par une chaîne codée en dur.
 */
export function canClaimProductionReady(level: ComplianceLevel = CURRENT_COMPLIANCE_LEVEL): boolean {
  return complianceRank(level) >= complianceRank('PRODUCTION_VALIDATED')
}

/** Formulations commerciales INTERDITES tant que la conformité n'est pas prouvée. */
export interface ForbiddenPattern { id: string; pattern: RegExp; reason: string }
export const FORBIDDEN_CLAIM_PATTERNS: ForbiddenPattern[] = [
  { id: 'certifie_conforme', pattern: /certifi[ée]e?s?\s+conforme/i, reason: 'Affirme une certification de conformité non prouvée.' },
  { id: 'pdp_integree', pattern: /pdp\s+int[ée]gr[ée]e?/i, reason: 'Affirme l’intégration d’une plateforme agréée inexistante.' },
  { id: 'plateforme_agreee_integree', pattern: /plateforme\s+agr[ée]{2}e?\s+int[ée]gr[ée]e?/i, reason: 'Sous-entend une PDP agréée intégrée.' },
  { id: 'certified_compliant', pattern: /certified\s+compliant/i, reason: 'Claim of certified compliance not proven.' },
  { id: 'homologue_facturation', pattern: /homologu[ée]e?\s+(pour\s+)?(la\s+)?facturation\s+[ée]lectronique/i, reason: 'Affirme une homologation officielle non obtenue.' },
]

export interface ForbiddenMatch { id: string; match: string; index: number; reason: string }

/** Détecte les formulations interdites dans un texte. */
export function scanForForbiddenClaims(text: string): ForbiddenMatch[] {
  const found: ForbiddenMatch[] = []
  for (const { id, pattern, reason } of FORBIDDEN_CLAIM_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      found.push({ id, match: m[0], index: m.index, reason })
      if (m.index === re.lastIndex) re.lastIndex++ // évite une boucle sur match vide
    }
  }
  return found
}

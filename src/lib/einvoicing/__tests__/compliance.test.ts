/**
 * Niveaux de conformité e-invoicing + scanner de formulations interdites.
 */
import { describe, it, expect } from 'vitest'
import {
  COMPLIANCE_LEVELS, CURRENT_COMPLIANCE_LEVEL, currentComplianceStatement,
  canClaimProductionReady, complianceRank, scanForForbiddenClaims, FORBIDDEN_CLAIM_PATTERNS,
} from '../compliance'

describe('niveaux de conformité', () => {
  it('le niveau courant est le sandbox interne (honnête)', () => {
    expect(CURRENT_COMPLIANCE_LEVEL).toBe('INTERNAL_SANDBOX_ONLY')
    expect(currentComplianceStatement()).toMatch(/simul[ée]/i)
    expect(currentComplianceStatement()).toMatch(/aucune plateforme agréée/i)
  })
  it('ne prétend PAS être prêt pour la production', () => {
    expect(canClaimProductionReady()).toBe(false)
    expect(canClaimProductionReady('INTERNAL_SANDBOX_ONLY')).toBe(false)
    expect(canClaimProductionReady('PRODUCTION_VALIDATED')).toBe(true)
  })
  it('les niveaux sont ordonnés', () => {
    expect(complianceRank('INTERNAL_SANDBOX_ONLY')).toBeLessThan(complianceRank('PRODUCTION_VALIDATED'))
    expect(COMPLIANCE_LEVELS[0]).toBe('INTERNAL_SANDBOX_ONLY')
  })
})

describe('scanForForbiddenClaims', () => {
  it('détecte les formulations interdites', () => {
    expect(scanForForbiddenClaims('Solution certifiée conforme à la réglementation').length).toBe(1)
    expect(scanForForbiddenClaims('Notre PDP intégrée transmet vos factures').length).toBe(1)
    expect(scanForForbiddenClaims('A certified compliant e-invoicing engine').length).toBe(1)
    expect(scanForForbiddenClaims('Logiciel homologué pour la facturation électronique').length).toBe(1)
  })
  it('n\'a pas de faux positif sur des formulations honnêtes', () => {
    expect(scanForForbiddenClaims('Moteur conforme au cœur EN 16931, prêt à l\'intégration PDP')).toEqual([])
    expect(scanForForbiddenClaims('Transmission via un fournisseur simulé (sandbox)')).toEqual([])
  })
  it('rapporte plusieurs occurrences', () => {
    const hits = scanForForbiddenClaims('certifié conforme ici et PDP intégrée là')
    expect(hits.length).toBe(2)
    expect(hits.map(h => h.id).sort()).toEqual(['certifie_conforme', 'pdp_integree'])
  })
  it('chaque pattern a un id et une raison', () => {
    for (const p of FORBIDDEN_CLAIM_PATTERNS) {
      expect(p.id).toBeTruthy()
      expect(p.reason).toBeTruthy()
    }
  })
})

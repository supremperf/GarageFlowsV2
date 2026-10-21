/**
 * Licence bloquée AU CHARGEMENT de la page d'accueil (GF-1021-10).
 *
 * Suspendue, révoquée ou expirée, la licence fait échouer le chargement
 * initial (403 sur `/api/garages`). L'overlay de licence n'était monté
 * qu'APRÈS ce chargement : la page restait indéfiniment sur « Chargement du
 * planning… », sans jamais dire pourquoi. Constaté dans un vrai navigateur
 * (dossier de preuves du 21/10/2026, captures 72 et 79).
 *
 * L'environnement de test est `node`, sans testing-library : ces gardes
 * portent sur le source ; le comportement est vérifié dans le navigateur.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const lire = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')

describe('licence bloquée au chargement de la page d’accueil', () => {
  it('l’overlay de licence est monté pendant l’écran de chargement', () => {
    const src = lire('app/page.tsx')
    const branche = src.match(/onboarding === 'loading'\)\s*\)\s*\{\s*return \(([\s\S]*?)\n {4}\)\n {2}\}/)
    expect(branche, 'branche de chargement introuvable').not.toBeNull()
    expect(branche![1]).toContain('<AppLoader />')
    expect(branche![1]).toContain('<LicenseRevokedOverlay onReactivated={recharger} />')
  })

  it('une réactivation survenue pendant le chargement recharge la page', () => {
    expect(lire('app/page.tsx')).toMatch(/function recharger\(\) \{\s*window\.location\.reload\(\)\s*\}/)
    // Seulement si aucun nouveau blocage n'est survenu entre-temps.
    expect(lire('components/LicenseRevokedOverlay.tsx')).toMatch(
      /if \(!blockedRef\.current\) \{\s*setInfo\(null\)\s*onReactivated\?\.\(\)\s*\}/,
    )
  })
})

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { EINVOICE_PLATFORM_CATALOG, searchPlatforms } from '@/lib/einvoicing/catalog'

/**
 * RÉGRESSION — écran des réglages détruit par une projection d'API incomplète.
 *
 * Observé en production (garageflow.log) :
 *   [renderer:error] TypeError: Cannot read properties of undefined
 *                    (reading 'localeCompare')
 *   [renderer:error] [app-error-boundary]
 *
 * Chaîne exacte :
 *   1. GET /api/einvoicing/status projetait chaque plateforme sur un
 *      sous-ensemble de champs — SANS `normalizedName` ;
 *   2. EInvoicingTab passait ce tableau tel quel à `searchPlatforms()` ;
 *   3. celle-ci trie sur `a.normalizedName.localeCompare(...)` → undefined ;
 *   4. l'appel ayant lieu dans un `useMemo`, l'exception survenait PENDANT le
 *      rendu : l'error boundary emportait tout l'écran des réglages.
 *
 * Ce n'était pas une donnée « rare » : la projection omettait le champ pour
 * TOUTES les plateformes — l'onglet plantait donc systématiquement.
 *
 * Deux verrous complémentaires ci-dessous : le CONTRAT (l'API doit fournir le
 * champ) et la ROBUSTESSE (la fonction ne doit pas lever si on le lui retire).
 */
describe('e-facturation — contrat entre /api/einvoicing/status et searchPlatforms', () => {
  /** Projection réellement appliquée par la route, extraite de sa source. */
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/einvoicing/status/route.ts'),
    'utf8',
  )

  it('la route expose bien `normalizedName`', () => {
    const start = routeSrc.indexOf('EINVOICE_PLATFORM_CATALOG.map')
    expect(start).toBeGreaterThan(-1)
    const projection = routeSrc.slice(start, start + 600)
    expect(projection).toMatch(/normalizedName:\s*p\.normalizedName/)
  })

  it('tout champ consulté par searchPlatforms est présent dans la projection', () => {
    const start = routeSrc.indexOf('EINVOICE_PLATFORM_CATALOG.map')
    const projection = routeSrc.slice(start, start + 600)
    // Champs lus par searchPlatforms : normalizedName, slug, officialName.
    for (const field of ['normalizedName', 'slug', 'officialName']) {
      expect(projection, `${field} doit être projeté`).toContain(`${field}:`)
    }
  })

  it('searchPlatforms ne lève PAS même si le champ est absent (robustesse)', () => {
    // On retire délibérément `normalizedName` : c'était la forme exacte qui
    // plantait. La fonction doit désormais dégrader, pas rompre.
    const amputé = EINVOICE_PLATFORM_CATALOG.map(({ normalizedName, ...reste }) => {
      void normalizedName
      return reste
    })
    expect(() => searchPlatforms('', amputé as never)).not.toThrow()
    expect(() => searchPlatforms('alpha', amputé as never)).not.toThrow()
  })

  it('la recherche reste fonctionnelle sur le catalogue complet', () => {
    const tous = searchPlatforms('')
    expect(tous.length).toBe(EINVOICE_PLATFORM_CATALOG.length)
    const ciblé = searchPlatforms('alpha')
    expect(ciblé.length).toBeGreaterThan(0)
    expect(ciblé[0].officialName.toLowerCase()).toContain('alpha')
  })
})

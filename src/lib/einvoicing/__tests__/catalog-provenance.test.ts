/**
 * GF31-AUD-020 (volet catalogue) — aucune plateforme fictive, provenance connue.
 *
 * Le catalogue livré contenait quatre entrées INVENTÉES — « Alpha Facturation »,
 * « Axion », « Azer », « Beta Invoice » — affichées dans l'onglet
 * « Facturation électronique » comme des plateformes agréées, avec la mention
 * « Agréée à titre provisoire ». Aucune ne correspond à une plateforme réelle.
 * Un catalogue réglementaire ne se fabrique pas : il s'importe, et sa provenance
 * s'affiche (§82).
 *
 * Ces contrôles portent sur le catalogue RÉELLEMENT chargé par l'application.
 */
import { describe, it, expect } from 'vitest'
import {
      searchPlatforms,
  isPlatformConnectable,
} from '@/lib/einvoicing/catalog'
import { EINVOICE_PLATFORM_CATALOG, EINVOICE_CATALOG_SOURCE, EINVOICE_CATALOG_IMPORTED_AT } from '@/lib/einvoicing/catalog-data'

/** Noms des entrées de démonstration retirées — ils ne doivent jamais revenir. */
const NOMS_FICTIFS = ['alpha facturation', 'axion', 'azer', 'beta invoice']

describe('provenance du catalogue', () => {
  it('déclare sa source, sa licence et l’autorité de référence', () => {
    expect(EINVOICE_CATALOG_SOURCE.portail).toMatch(/^https:\/\/www\.data\.gouv\.fr\//)
    expect(EINVOICE_CATALOG_SOURCE.licence).toBe('ODbL')
    // L'autorité qui fait foi reste impots.gouv.fr, pas la republication.
    expect(EINVOICE_CATALOG_SOURCE.autoriteDeReference).toMatch(/^https:\/\/www\.impots\.gouv\.fr\//)
    expect(EINVOICE_CATALOG_SOURCE.avertissement).toMatch(/impots\.gouv\.fr fait foi/i)
  })

  it('porte une date d’import exploitable', () => {
    expect(EINVOICE_CATALOG_IMPORTED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('aucune plateforme fictive', () => {
  it('les quatre entrées de démonstration ont disparu', () => {
    const presents = EINVOICE_PLATFORM_CATALOG
      .filter((p) => NOMS_FICTIFS.includes(p.normalizedName))
      .map((p) => p.officialName)
    expect(presents).toEqual([])
  })

  it('aucun identifiant ne porte le préfixe « example- »', () => {
    expect(EINVOICE_PLATFORM_CATALOG.filter((p) => p.id.startsWith('example-'))).toEqual([])
  })

  it('le catalogue n’est pas vide et a une taille plausible pour le registre', () => {
    // 101 plateformes à la première publication, ~137 à l'été 2026 : une valeur
    // à un chiffre signalerait un import cassé, pas un registre qui rétrécit.
    expect(EINVOICE_PLATFORM_CATALOG.length).toBeGreaterThan(50)
  })
})

describe('intégrité de chaque entrée', () => {
  it('les champs obligatoires sont présents et cohérents', () => {
    for (const p of EINVOICE_PLATFORM_CATALOG) {
      expect(p.id).toBeTruthy()
      expect(p.officialName).toBeTruthy()
      // `normalizedName` fait partie du contrat consommé par `searchPlatforms`.
      expect(p.normalizedName).toBe(
        p.officialName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
      )
      expect(['approved', 'provisionally_approved', 'suspended', 'withdrawn'])
        .toContain(p.approvalStatus)
      if (p.registeredAt) expect(p.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (p.officialWebsite) expect(p.officialWebsite).toMatch(/^https?:\/\//)
    }
  })

  it('les identifiants sont uniques', () => {
    const ids = EINVOICE_PLATFORM_CATALOG.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('n’invente AUCUNE méthode d’authentification — la source n’en donne pas', () => {
    for (const p of EINVOICE_PLATFORM_CATALOG) {
      expect(p.authenticationMethods).toEqual([])
    }
  })

  it('n’annonce AUCUNE capacité d’intégration sans adaptateur', () => {
    for (const p of EINVOICE_PLATFORM_CATALOG) {
      expect(p.integrationStatus).toBe('coming_soon')
      expect(isPlatformConnectable(p, () => true)).toBe(false)
      // `capabilities` décrit ce que GarageFlows sait faire, pas ce que la
      // plateforme annonce — ce dernier vit dans `declaredFormats`.
      expect(Object.values(p.capabilities).filter((v) => v === true && p.capabilities.sandbox !== v))
        .toEqual([])
    }
  })
})

describe('recherche sur données réelles', () => {
  it('trouve une plateforme par son nom exact', () => {
    const sonde = EINVOICE_PLATFORM_CATALOG[10] ?? EINVOICE_PLATFORM_CATALOG[0]
    expect(searchPlatforms(sonde.officialName, EINVOICE_PLATFORM_CATALOG).some((p) => p.id === sonde.id)).toBe(true)
  })

  it('reste insensible à la casse et aux accents', () => {
    const sonde = EINVOICE_PLATFORM_CATALOG[0]
    expect(searchPlatforms(sonde.officialName.toUpperCase(), EINVOICE_PLATFORM_CATALOG).some((p) => p.id === sonde.id)).toBe(true)
  })

  it('une requête vide renvoie tout le catalogue, trié', () => {
    const tous = searchPlatforms('', EINVOICE_PLATFORM_CATALOG)
    expect(tous.length).toBe(EINVOICE_PLATFORM_CATALOG.length)
    const noms = tous.map((p) => p.normalizedName)
    expect([...noms].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(noms)
  })
})

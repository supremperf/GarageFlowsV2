/**
 * Tests des fonctions pures de scripts/apply-brand.js (codegen packaging marque blanche).
 */
import { describe, it, expect } from 'vitest'
import * as applyBrand from '../../../scripts/apply-brand.js'

const { slugifyName, resolveBrandForPackaging, applyToPackageJson, applyToMainJs } = applyBrand as {
  slugifyName: (s: string) => string
  resolveBrandForPackaging: (json: unknown, env: Record<string, string>, existingCopyright?: string) => {
    productName: string; appId: string; companyName: string; npmName: string; author: string; copyright: string; shortcutName: string
  }
  applyToPackageJson: (pkg: unknown, r: unknown) => Record<string, unknown>
  applyToMainJs: (src: string, appId: string) => string
}

describe('slugifyName', () => {
  it('produit un identifiant npm valide', () => {
    expect(slugifyName('AtelierPro')).toBe('atelierpro')
    expect(slugifyName('Méca Suite')).toBe('meca-suite')
    expect(slugifyName('  Garage & Fils  ')).toBe('garage-fils')
    expect(slugifyName('')).toBe('app')
  })
})

describe('resolveBrandForPackaging', () => {
  it('renvoie les défauts GarageFlow sans config', () => {
    const r = resolveBrandForPackaging({}, {}, 'Copyright © 2026 GarageFlow')
    expect(r.productName).toBe('GarageFlow')
    expect(r.appId).toBe('com.garageflow.app')
    expect(r.npmName).toBe('garageflow')
    expect(r.author).toBe('GarageFlow')
    expect(r.copyright).toBe('Copyright © 2026 GarageFlow')
    expect(r.shortcutName).toBe('GarageFlow')
  })
  it('applique un brand.config.json complet', () => {
    const r = resolveBrandForPackaging(
      { productName: 'AtelierPro', companyName: 'Atelier SAS', packaging: { appId: 'com.atelier.pro', productName: 'AtelierPro' } },
      {},
      'Copyright © 2026 GarageFlow',
    )
    expect(r.productName).toBe('AtelierPro')
    expect(r.appId).toBe('com.atelier.pro')
    expect(r.npmName).toBe('atelierpro')
    expect(r.author).toBe('Atelier SAS')
    expect(r.copyright).toBe('Copyright © 2026 Atelier SAS')
  })
  it('donne priorité à l’env sur le JSON', () => {
    const r = resolveBrandForPackaging(
      { packaging: { appId: 'com.atelier.pro' } },
      { GF_BRAND_APP_ID: 'com.override.app', GF_BRAND_EXE_PRODUCT_NAME: 'OverrideApp' },
      'Copyright © 2025 X',
    )
    expect(r.appId).toBe('com.override.app')
    expect(r.productName).toBe('OverrideApp')
    expect(r.copyright).toContain('2025')
  })
})

describe('applyToPackageJson', () => {
  it('patche les clés sans muter l’entrée', () => {
    const pkg = { name: 'garageflow', productName: 'GarageFlow', author: 'GarageFlow', build: { appId: 'com.garageflow.app', productName: 'GarageFlow', copyright: 'x', nsis: { shortcutName: 'GarageFlow', oneClick: false } } }
    const r = { productName: 'AtelierPro', appId: 'com.atelier.pro', npmName: 'atelierpro', author: 'Atelier SAS', copyright: 'Copyright © 2026 Atelier SAS', shortcutName: 'AtelierPro' }
    const next = applyToPackageJson(pkg, r) as any
    expect(next.name).toBe('atelierpro')
    expect(next.productName).toBe('AtelierPro')
    expect(next.author).toBe('Atelier SAS')
    expect(next.build.appId).toBe('com.atelier.pro')
    expect(next.build.productName).toBe('AtelierPro')
    expect(next.build.copyright).toBe('Copyright © 2026 Atelier SAS')
    expect(next.build.nsis.shortcutName).toBe('AtelierPro')
    expect(next.build.nsis.oneClick).toBe(false) // préservé
    // entrée non mutée
    expect(pkg.name).toBe('garageflow')
    expect(pkg.build.appId).toBe('com.garageflow.app')
  })
})

describe('applyToMainJs', () => {
  it('remplace l’appId de setAppUserModelId', () => {
    const src = "app.setAppUserModelId('com.garageflow.app')\nconst x = 1"
    expect(applyToMainJs(src, 'com.atelier.pro')).toBe("app.setAppUserModelId('com.atelier.pro')\nconst x = 1")
  })
  it('est idempotent', () => {
    const src = "app.setAppUserModelId('com.atelier.pro')"
    expect(applyToMainJs(src, 'com.atelier.pro')).toBe(src)
  })
})

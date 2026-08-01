/**
 * Marque côté client — vérifie les overrides NEXT_PUBLIC_* et l'absence de dérive
 * par rapport aux défauts partagés (brand.defaults.ts), sans dépendre de fs.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_BRAND } from '../brand.defaults'

const KEYS = [
  'NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME',
  'NEXT_PUBLIC_GF_BRAND_SHORT_NAME',
  'NEXT_PUBLIC_GF_BRAND_TAGLINE',
  'NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY',
  'NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY',
  'NEXT_PUBLIC_GF_BRAND_PRIMARY_COLOR',
  'NEXT_PUBLIC_GF_BRAND_PRIMARY_DARK_COLOR',
  'NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR',
  'NEXT_PUBLIC_GF_BRAND_SUPPORT_URL',
  'NEXT_PUBLIC_GF_BRAND_MARKETING_DOMAIN',
]

function clear() {
  for (const k of KEYS) delete process.env[k]
  vi.resetModules()
}

afterEach(clear)

describe('brand.client — défauts sans dérive', () => {
  it('reprend les défauts partagés quand aucun override', async () => {
    clear()
    const { CLIENT_BRAND } = await import('../brand.client')
    expect(CLIENT_BRAND.productName).toBe(DEFAULT_BRAND.productName)
    expect(CLIENT_BRAND.wordmark).toEqual(DEFAULT_BRAND.wordmark)
    expect(CLIENT_BRAND.colors).toEqual(DEFAULT_BRAND.colors)
    expect(CLIENT_BRAND.marketingDomain).toBe(DEFAULT_BRAND.domains.marketing)
  })
})

describe('brand.client — overrides NEXT_PUBLIC_*', () => {
  it('applique un rebranding complet (nom, wordmark, couleurs)', async () => {
    clear()
    process.env.NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME = 'AtelierPro'
    process.env.NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY = 'Atelier'
    process.env.NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY = 'Pro'
    process.env.NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR = '#38bdf8'
    const { CLIENT_BRAND } = await import('../brand.client')
    expect(CLIENT_BRAND.productName).toBe('AtelierPro')
    expect(CLIENT_BRAND.wordmark).toEqual({ primary: 'Atelier', secondary: 'Pro' })
    expect(CLIENT_BRAND.colors.accent).toBe('#38bdf8')
    // Champ non surchargé → défaut conservé.
    expect(CLIENT_BRAND.colors.primary).toBe(DEFAULT_BRAND.colors.primary)
  })
})

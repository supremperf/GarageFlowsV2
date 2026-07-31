/**
 * White-label brand configuration tests.
 *
 * Verifies the three override layers (defaults ← JSON ← env), Zod validation,
 * and the safe-fallback contract (a malformed override must never throw).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveBrand, DEFAULT_BRAND_CONFIG, BRAND } from '../brand'

const BRAND_ENV_KEYS = Object.keys(process.env).filter((k) => k.startsWith('GF_BRAND_'))

function clearBrandEnv() {
  for (const k of BRAND_ENV_KEYS) delete process.env[k]
  delete process.env.GF_BRAND_CONFIG
  delete process.env.GF_BRAND_PRODUCT_NAME
  delete process.env.GF_BRAND_PRIMARY_COLOR
  delete process.env.GF_BRAND_APP_DOMAIN
  delete process.env.GF_BRAND_SUPPORT_EMAIL
  delete process.env.GF_BRAND_MAIL_FROM
  delete process.env.GF_BRAND_COMPANY
}

afterEach(() => {
  clearBrandEnv()
  vi.restoreAllMocks()
})

describe('brand config — defaults', () => {
  it('exposes a validated GarageFlow default identity', () => {
    clearBrandEnv()
    const brand = resolveBrand()
    expect(brand.productName).toBe('GarageFlow')
    expect(brand.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(brand.domains.app).toBe('app.garageflows.fr')
    expect(brand.support.email).toContain('@')
  })

  it('memoised BRAND matches the default identity when no override is set', () => {
    expect(BRAND.productName).toBe(DEFAULT_BRAND_CONFIG.productName)
  })
})

describe('brand config — environment overrides', () => {
  it('applies a discrete env override (product name)', () => {
    clearBrandEnv()
    process.env.GF_BRAND_PRODUCT_NAME = 'AtelierPro'
    expect(resolveBrand().productName).toBe('AtelierPro')
  })

  it('applies nested env overrides (colours, domain, support)', () => {
    clearBrandEnv()
    process.env.GF_BRAND_PRIMARY_COLOR = '#111827'
    process.env.GF_BRAND_APP_DOMAIN = 'app.atelierpro.example'
    process.env.GF_BRAND_SUPPORT_EMAIL = 'aide@atelierpro.example'
    const brand = resolveBrand()
    expect(brand.colors.primary).toBe('#111827')
    expect(brand.domains.app).toBe('app.atelierpro.example')
    expect(brand.support.email).toBe('aide@atelierpro.example')
    // Untouched fields keep the defaults.
    expect(brand.colors.accent).toBe(DEFAULT_BRAND_CONFIG.colors.accent)
  })

  it('supports a full inline JSON override via GF_BRAND_CONFIG', () => {
    clearBrandEnv()
    process.env.GF_BRAND_CONFIG = JSON.stringify({
      productName: 'MécaSuite',
      wordmark: { primary: 'Méca', secondary: 'Suite' },
      commercial: { email: 'sales@mecasuite.example' },
    })
    const brand = resolveBrand()
    expect(brand.productName).toBe('MécaSuite')
    expect(brand.wordmark.secondary).toBe('Suite')
    expect(brand.commercial.email).toBe('sales@mecasuite.example')
    // Env layer wins over JSON layer.
    process.env.GF_BRAND_PRODUCT_NAME = 'Override'
    expect(resolveBrand().productName).toBe('Override')
  })
})

describe('brand config — safe fallback', () => {
  it('falls back to defaults (never throws) on an invalid colour', () => {
    clearBrandEnv()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GF_BRAND_PRIMARY_COLOR = 'not-a-color'
    const brand = resolveBrand()
    expect(brand).toEqual(DEFAULT_BRAND_CONFIG)
    expect(warn).toHaveBeenCalled()
  })

  it('falls back to defaults on an invalid support email', () => {
    clearBrandEnv()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GF_BRAND_SUPPORT_EMAIL = 'not-an-email'
    expect(resolveBrand()).toEqual(DEFAULT_BRAND_CONFIG)
  })

  it('ignores malformed inline JSON without throwing', () => {
    clearBrandEnv()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GF_BRAND_CONFIG = '{ this is not json'
    expect(() => resolveBrand()).not.toThrow()
    expect(resolveBrand().productName).toBe('GarageFlow')
  })
})

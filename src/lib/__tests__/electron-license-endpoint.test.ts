import { describe, it, expect } from 'vitest'

// Module CommonJS du process Electron (résolution de l'autorité de licence).
const { resolveLicenseServer, OFFICIAL_LICENSE_SERVER } = require('../../../electron/license-endpoint.js')

describe('resolveLicenseServer — défaut compilé (anti fail-open)', () => {
  it('sans GF_LICENSE_SERVER → URL officielle compilée (jamais vide)', () => {
    expect(resolveLicenseServer({ envUrl: undefined, isPackaged: true })).toBe(OFFICIAL_LICENSE_SERVER)
    expect(resolveLicenseServer({ envUrl: '', isPackaged: true })).toBe(OFFICIAL_LICENSE_SERVER)
    expect(resolveLicenseServer({})).toBe(OFFICIAL_LICENSE_SERVER)
  })

  it('surcharge https autorisée (staging/self-hosted), slash final retiré', () => {
    expect(resolveLicenseServer({ envUrl: 'https://staging.garageflows.fr/', isPackaged: true }))
      .toBe('https://staging.garageflows.fr')
  })

  it('en PROD packagée, une surcharge NON https est refusée → URL officielle', () => {
    expect(resolveLicenseServer({ envUrl: 'http://evil.example', isPackaged: true })).toBe(OFFICIAL_LICENSE_SERVER)
    expect(resolveLicenseServer({ envUrl: 'http://127.0.0.1:9', isPackaged: true })).toBe(OFFICIAL_LICENSE_SERVER)
  })

  it('en DEV (non packagé), une surcharge http locale est autorisée', () => {
    expect(resolveLicenseServer({ envUrl: 'http://localhost:3000', isPackaged: false }))
      .toBe('http://localhost:3000')
  })
})

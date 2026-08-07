/**
 * En-têtes de sécurité HTTP (V13, lot G) — garde de non-régression.
 *
 * Vérifie la configuration RÉELLE (`next.config.mjs → headers()`) : la CSP et
 * les en-têtes critiques doivent rester présents et ne jamais se relâcher
 * silencieusement (unsafe-eval, frame-ancestors, HSTS…). Toute exception
 * assumée (ex. 'unsafe-inline' styles exigé par le CSS-in-JS de Next) est
 * verrouillée ici EXPLICITEMENT : si elle devient inutile, le test force à la
 * retirer consciemment.
 */
import { describe, it, expect, beforeAll } from 'vitest'

let headerMap: Record<string, string>

beforeAll(async () => {
  const cfg = (await import('../../next.config.mjs')).default as {
    headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>
  }
  const all = await cfg.headers()
  const global = all.find((h) => h.source === '/(.*)' || h.source === '/:path*' || h.source.includes('(.*)'))
  expect(global, 'un bloc d’en-têtes global doit exister').toBeTruthy()
  headerMap = Object.fromEntries(global!.headers.map((h) => [h.key.toLowerCase(), h.value]))
})

describe('en-têtes de sécurité globaux', () => {
  it('CSP présente, avec frame-ancestors none et sans unsafe-eval', () => {
    const csp = headerMap['content-security-policy']
    expect(csp).toBeTruthy()
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
  })
  it('X-Content-Type-Options: nosniff', () => {
    expect(headerMap['x-content-type-options']).toBe('nosniff')
  })
  it('Referrer-Policy restrictive', () => {
    expect(headerMap['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
  it('Permissions-Policy neutralise caméra/micro/géoloc', () => {
    const pp = headerMap['permissions-policy']
    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
  })
  it('HSTS ≥ 1 an avec includeSubDomains', () => {
    const hsts = headerMap['strict-transport-security']
    expect(hsts).toBeTruthy()
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)
    expect(maxAge).toBeGreaterThanOrEqual(31536000)
    expect(hsts).toContain('includeSubDomains')
  })
  it("exception assumée et VERROUILLÉE : 'unsafe-inline' scripts (hydratation Next sans nonce, AUD-024)", () => {
    const csp = headerMap['content-security-policy']
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
    // L'exception est verrouillée à l'identique : si le durcissement par nonce
    // la rend inutile un jour, ce test casse et force sa suppression CONSCIENTE.
    // Elle ne doit jamais s'élargir (unsafe-eval hors dev, hosts externes).
    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc.replace("'self'", '').replace("'unsafe-inline'", '').trim()).toBe('')
  })
  it("'unsafe-eval' est réservé au développement (jamais dans la CSP de production)", () => {
    // Le test s'exécute hors NODE_ENV=development : la CSP évaluée ici est
    // celle de production/test — elle ne doit pas contenir unsafe-eval.
    expect(headerMap['content-security-policy']).not.toContain('unsafe-eval')
  })
})

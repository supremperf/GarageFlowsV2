import { describe, it, expect } from 'vitest'

// Module CommonJS du process Electron (garde de navigation will-navigate/redirect).
const { isLocalAppUrl } = require('../../../electron/nav-guard.js')

const LOCAL = 'http://127.0.0.1:4028'

describe('nav-guard — n\'autorise que l\'origine locale exacte', () => {
  it('autorise la page locale de l\'app', () => {
    expect(isLocalAppUrl('http://127.0.0.1:4028/', LOCAL)).toBe(true)
    expect(isLocalAppUrl('http://127.0.0.1:4028/login?x=1#h', LOCAL)).toBe(true)
  })

  it('BLOQUE le contournement par userinfo (host réel = evil.com)', () => {
    // Une comparaison startsWith() aurait laissé passer ces URLs.
    expect(isLocalAppUrl('http://127.0.0.1:4028@evil.com/', LOCAL)).toBe(false)
    expect(isLocalAppUrl('http://127.0.0.1:4028:pass@evil.com/x', LOCAL)).toBe(false)
  })

  it('BLOQUE un port dont le préfixe correspond', () => {
    expect(isLocalAppUrl('http://127.0.0.1:40288/', LOCAL)).toBe(false)
  })

  it('BLOQUE les origines externes et les protocoles dangereux', () => {
    expect(isLocalAppUrl('https://garageflows.fr/', LOCAL)).toBe(false)
    expect(isLocalAppUrl('file:///etc/passwd', LOCAL)).toBe(false)
    expect(isLocalAppUrl('javascript:alert(1)', LOCAL)).toBe(false)
    expect(isLocalAppUrl('http://127.0.0.1/', LOCAL)).toBe(false) // port 80 ≠ 4028
    expect(isLocalAppUrl('http://localhost:4028/', LOCAL)).toBe(false) // hostname ≠ 127.0.0.1
  })

  it('BLOQUE une entrée non-URL', () => {
    expect(isLocalAppUrl('', LOCAL)).toBe(false)
    expect(isLocalAppUrl('not a url', LOCAL)).toBe(false)
    expect(isLocalAppUrl(undefined, LOCAL)).toBe(false) // robustesse valeur non-string
    expect(isLocalAppUrl(null, LOCAL)).toBe(false)
  })
})

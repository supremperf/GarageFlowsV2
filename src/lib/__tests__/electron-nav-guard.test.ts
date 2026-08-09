import { describe, it, expect } from 'vitest'

// Module CommonJS du process Electron (garde de navigation will-navigate/redirect).
const { isLocalAppUrl, canonicalizeLoopbackUrl } = require('../../../electron/nav-guard.js')

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

// ── Réécriture loopback (fix écran blanc desktop) ────────────────────────────
// Le serveur Next standalone redirige « / → /login » sur l'hôte « localhost »
// tandis que la fenêtre est sur « 127.0.0.1 » : deux origines distinctes que le
// nav-guard bloquait → écran blanc. canonicalizeLoopbackUrl réécrit le MÊME
// serveur loopback vers l'origine canonique, sans élargir la surface.
describe('nav-guard — canonicalizeLoopbackUrl (localhost ↔ 127.0.0.1, même serveur)', () => {
  it('RÉGRESSION écran blanc : localhost:PORT → 127.0.0.1:PORT (chemin/query/fragment conservés)', () => {
    expect(canonicalizeLoopbackUrl('http://localhost:4028/login?callbackUrl=%2F', LOCAL))
      .toBe('http://127.0.0.1:4028/login?callbackUrl=%2F')
    expect(canonicalizeLoopbackUrl('http://localhost:4028/license', LOCAL))
      .toBe('http://127.0.0.1:4028/license')
    expect(canonicalizeLoopbackUrl('http://localhost:4028/a?b=1#h', LOCAL))
      .toBe('http://127.0.0.1:4028/a?b=1#h')
  })

  it('réécrit aussi [::1] (IPv6 loopback) sur le même port', () => {
    expect(canonicalizeLoopbackUrl('http://[::1]:4028/login', LOCAL))
      .toBe('http://127.0.0.1:4028/login')
  })

  it('null si déjà canonique (l\'appelant l\'autorise via isLocalAppUrl)', () => {
    expect(canonicalizeLoopbackUrl('http://127.0.0.1:4028/login', LOCAL)).toBeNull()
  })

  it('N\'ÉLARGIT PAS la surface : origines externes / port / protocole / userinfo → null', () => {
    expect(canonicalizeLoopbackUrl('https://garageflows.fr/', LOCAL)).toBeNull()      // externe
    expect(canonicalizeLoopbackUrl('http://evil.com/login', LOCAL)).toBeNull()        // externe
    expect(canonicalizeLoopbackUrl('http://localhost:40288/login', LOCAL)).toBeNull() // MAUVAIS port
    expect(canonicalizeLoopbackUrl('http://localhost:9999/login', LOCAL)).toBeNull()  // MAUVAIS port
    expect(canonicalizeLoopbackUrl('https://localhost:4028/login', LOCAL)).toBeNull() // MAUVAIS protocole
    expect(canonicalizeLoopbackUrl('http://127.0.0.1:4028@evil.com/x', LOCAL)).toBeNull() // userinfo → host=evil.com
    expect(canonicalizeLoopbackUrl('file:///etc/passwd', LOCAL)).toBeNull()
    expect(canonicalizeLoopbackUrl('not a url', LOCAL)).toBeNull()
  })
})

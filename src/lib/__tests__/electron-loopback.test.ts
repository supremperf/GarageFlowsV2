import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Phase 3 — le serveur interne Electron doit écouter EXCLUSIVEMENT sur la
 * boucle locale (127.0.0.1) et jamais sur 0.0.0.0 (exposition LAN).
 *
 * Le serveur Next.js « standalone » lie l'adresse fournie par la variable
 * d'environnement HOSTNAME (`const hostname = process.env.HOSTNAME || '0.0.0.0'`),
 * puis appelle server.listen(port, hostname). Il suffit donc de garantir que
 * main.js transmet HOSTNAME=127.0.0.1 et n'injecte jamais 0.0.0.0.
 */
describe('electron/main — liaison loopback du serveur interne', () => {
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')

  it('transmet HOSTNAME=127.0.0.1 au serveur Next.js', () => {
    expect(/HOSTNAME:\s*'127\.0\.0\.1'/.test(mainSrc)).toBe(true)
  })

  it('ne lie jamais le serveur interne à 0.0.0.0', () => {
    // Aucune affectation HOSTNAME: '0.0.0.0' ne doit subsister.
    expect(/HOSTNAME:\s*'0\.0\.0\.0'/.test(mainSrc)).toBe(false)
  })

  it('les appels internes main → serveur restent en loopback direct (127.0.0.1)', () => {
    // Ces appels partent du processus principal (Node), pas du navigateur : ils
    // visent l'adresse d'écoute réelle, sans résolution DNS.
    expect(mainSrc.includes('http://127.0.0.1:${PORT}')).toBe(true)
  })
})

/**
 * RÉGRESSION « écran noir au démarrage ».
 *
 * Next réécrit INCONDITIONNELLEMENT tout hôte 127.x.x.x / [::1] en « localhost »
 * (REGEX_LOCALHOST_HOSTNAME dans next/dist/server/web/next-url.js) : une fenêtre
 * chargée sur http://127.0.0.1:PORT recevait un « Location: http://localhost:PORT/… »,
 * donc une AUTRE origine. Le garde `will-redirect` bloquait ce saut → la fenêtre
 * principale ne chargeait jamais et le splash restait affiché indéfiniment.
 * Mesuré sur le serveur standalone réel :
 *   fenêtre sur 127.0.0.1 → Location: http://localhost:PORT/login   (cross-origin)
 *   fenêtre sur localhost → Location: http://localhost:PORT/login   (même origine, 200)
 *
 * L'invariant est donc : TOUT ce que le navigateur voit — URL de la fenêtre,
 * cookies injectés, NEXTAUTH_URL — porte la MÊME origine, celle que Next impose.
 * L'écoute, elle, reste sur 127.0.0.1 (couverte par le bloc ci-dessus).
 */
describe('electron/main — origine unique côté navigateur (anti écran noir)', () => {
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')

  it('définit APP_ORIGIN sur localhost — l’hôte vers lequel Next normalise', () => {
    expect(/const APP_ORIGIN\s*=\s*`http:\/\/localhost:\$\{PORT\}`/.test(mainSrc)).toBe(true)
  })

  it('force la résolution Chromium localhost → 127.0.0.1 (pas de tentative ::1)', () => {
    // « localhost » résout en [::1] PUIS 127.0.0.1 ; le serveur n'écoutant que sur
    // 127.0.0.1, sans cette règle Chromium ne réussirait que par repli.
    expect(/appendSwitch\(\s*'host-resolver-rules'\s*,\s*'MAP localhost 127\.0\.0\.1'\s*\)/.test(mainSrc))
      .toBe(true)
  })

  it('la fenêtre principale charge APP_ORIGIN', () => {
    expect(/const APP_URL\s*=\s*APP_ORIGIN/.test(mainSrc)).toBe(true)
  })

  it('NEXTAUTH_URL vaut APP_ORIGIN (jamais un littéral 127.0.0.1)', () => {
    expect(/NEXTAUTH_URL:\s*APP_ORIGIN/.test(mainSrc)).toBe(true)
    expect(/NEXTAUTH_URL:\s*`http:\/\/127\.0\.0\.1/.test(mainSrc)).toBe(false)
  })

  it('les cookies de licence sont posés sur APP_ORIGIN', () => {
    // Un cookie posé sur une autre origine que la fenêtre ne serait jamais
    // renvoyé : l'utilisateur resterait bloqué sur /license malgré une licence.
    const idx = mainSrc.indexOf('async function injectLicenseCookies')
    expect(idx).toBeGreaterThan(-1)
    const block = mainSrc.slice(idx, idx + 600)
    expect(/const baseUrl\s*=\s*APP_ORIGIN/.test(block)).toBe(true)
  })

  it('le cookie de session est HttpOnly + SameSite=Strict', () => {
    // Extrait le bloc de pose du cookie gf_session.
    const idx = mainSrc.indexOf("name:           'gf_session'")
    expect(idx).toBeGreaterThan(-1)
    const block = mainSrc.slice(idx, idx + 400)
    expect(/httpOnly:\s*true/.test(block)).toBe(true)
    expect(/sameSite:\s*'strict'/.test(block)).toBe(true)
  })
})

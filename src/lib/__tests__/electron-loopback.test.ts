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

  it('utilise une URL d’authentification en loopback (127.0.0.1)', () => {
    expect(mainSrc.includes('http://127.0.0.1:${PORT}')).toBe(true)
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

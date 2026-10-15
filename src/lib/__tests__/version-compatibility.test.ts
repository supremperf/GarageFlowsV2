/**
 * GARDE — compatibilité de version poste / API / PWA, et versionnement du cache.
 *
 * Ce que ces tests empêchent de revenir :
 *  • un client qui n'a AUCUN moyen de savoir s'il parle à un serveur compatible ;
 *  • une version applicative qui diverge de package.json (source unique) ;
 *  • un service worker dont le nom de cache est figé dans le code : deux
 *    releases partageaient alors le même cache et, le fichier sw.js n'ayant pas
 *    changé d'un octet, le navigateur ne détectait aucune mise à jour ;
 *  • un contrat d'API qui évolue sans que son numéro bouge.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { evaluateCompatibility, API_CONTRACT } from '@/lib/version'

const ROOT = path.resolve(__dirname, '../../..')

describe('verdict de compatibilité', () => {
  it('sans minimum configuré, tout client est accepté', () => {
    expect(evaluateCompatibility('1.0.0', null)).toEqual({ status: 'ok' })
    expect(evaluateCompatibility(undefined, null)).toEqual({ status: 'ok' })
  })

  it('un client à la version minimale est accepté', () => {
    expect(evaluateCompatibility('1.1.0', '1.1.0')).toEqual({ status: 'ok' })
  })

  it('un client plus récent est accepté', () => {
    expect(evaluateCompatibility('1.2.0', '1.1.0')).toEqual({ status: 'ok' })
    expect(evaluateCompatibility('2.0.0', '1.9.9')).toEqual({ status: 'ok' })
  })

  it('un client trop ancien est déclaré incompatible', () => {
    expect(evaluateCompatibility('1.0.9', '1.1.0')).toEqual({ status: 'incompatible', minimum: '1.1.0' })
  })

  it('une version absente ou illisible est incompatible, jamais tolérée', () => {
    // Défaut SÛR : dans le doute on refuse d'écrire, on ne laisse pas passer.
    expect(evaluateCompatibility(null, '1.1.0')).toEqual({ status: 'incompatible', minimum: '1.1.0' })
    expect(evaluateCompatibility('', '1.1.0')).toEqual({ status: 'incompatible', minimum: '1.1.0' })
    expect(evaluateCompatibility('beta', '1.1.0')).toEqual({ status: 'incompatible', minimum: '1.1.0' })
    expect(evaluateCompatibility('1.1.0-rc1', '1.1.0')).toEqual({ status: 'incompatible', minimum: '1.1.0' })
  })
})

describe('source unique de version', () => {
  it('la version injectée au build vient de package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const config = readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8')
    expect(config).toMatch(/NEXT_PUBLIC_GF_VERSION/)
    expect(config).toMatch(/package\.json/)
    // Aucune version recopiée à la main dans next.config.mjs.
    expect(config).not.toContain(`'${pkg.version}'`)
    expect(config).not.toContain(`"${pkg.version}"`)
  })

  it('le contrat d’API est un entier positif', () => {
    expect(Number.isInteger(API_CONTRACT)).toBe(true)
    expect(API_CONTRACT).toBeGreaterThanOrEqual(1)
  })
})

describe('service worker versionné', () => {
  const sw = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8')

  it('le nom de cache est dérivé de la version, pas figé', () => {
    expect(sw).toMatch(/searchParams\.get\('v'\)/)
    expect(sw).not.toMatch(/const VERSION = 'gf-v1'/)
  })

  it('les caches des autres versions sont purgés à l’activation', () => {
    expect(sw).toMatch(/keys\.filter\(\(k\) => !k\.startsWith\(VERSION\)\)/)
  })

  it('l’API n’est JAMAIS mise en cache', () => {
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/)
  })

  it('aucune activation forcée à l’installation (saisie en cours préservée)', () => {
    // skipWaiting ne doit exister QUE dans le gestionnaire de message, déclenché
    // par un clic explicite de l'utilisateur.
    // Les commentaires sont retirés : ils DÉCRIVENT justement pourquoi on
    // n'appelle pas skipWaiting ici, et feraient échouer la recherche.
    const install = sw
      .slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"))
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    expect(install).not.toMatch(/skipWaiting\(\)/)
    expect(sw).toMatch(/SKIP_WAITING/)
  })

  it('la page enregistre le worker avec la version dans l’URL', () => {
    const reg = readFileSync(path.join(ROOT, 'src/components/PwaRegister.tsx'), 'utf8')
    expect(reg).toMatch(/\/sw\.js\?v=/)
    expect(reg).toMatch(/NEXT_PUBLIC_GF_VERSION/)
  })
})

/**
 * GF-DUR-039 / GF-DUR-040 — cache PWA et chaîne de mise à jour.
 *
 * Deux défauts distincts, tous deux invisibles en développement et coûteux en
 * production, parce qu'ils ne se manifestent qu'au MOMENT d'un déploiement.
 *
 * ─── GF-DUR-039 : un 404 mis en cache pour toujours ─────────────────────────
 * La branche des assets statiques est cache-first : une réponse stockée est
 * resservie sans jamais réinterroger le réseau, pour toute la durée de vie de la
 * version. Or elle mettait en cache la réponse SANS regarder son statut.
 *
 * Pendant une mise en production, un fragment `/_next/static/chunks/*.js` peut
 * manquer quelques secondes — le HTML de la nouvelle version est déjà servi
 * alors que l'asset n'est pas encore en place. Le navigateur recevait un 404, le
 * MÉMORISAIT, et le resservait indéfiniment : l'application restait cassée sur
 * cet appareil jusqu'à la version suivante, et aucun rechargement n'y changeait
 * rien. La branche des pages, elle, vérifiait déjà `res.ok`.
 *
 * ─── GF-DUR-040 : une mise à jour déjà prête, jamais annoncée ───────────────
 * `updatefound` ne se déclenche qu'au moment où un nouveau worker est
 * découvert. Installé lors d'une visite précédente, il attend — et l'événement
 * est passé. La barre « Mettre à jour » ne s'affichait jamais, et l'appareil
 * restait sur l'ancienne version jusqu'à la fermeture de TOUS les onglets. Sur
 * un écran d'atelier laissé ouvert en permanence, cela n'arrive pas.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('service worker : rien d’anormal ne se mémorise (GF-DUR-039)', () => {
  const sw = lire('public/sw.js')

  it('la branche cache-first ne stocke QUE les réponses saines', () => {
    const bloc = sw.slice(sw.indexOf('if (isStaticAsset(url))'), sw.indexOf('request.mode === \'navigate\''))
    expect(bloc, 'un 404 mis en cache-first ne se répare jamais').toMatch(/if \(res\.ok\)/)
    // Et la mise en cache est BIEN à l'intérieur de cette garde.
    expect(bloc.indexOf('if (res.ok)')).toBeLessThan(bloc.indexOf('caches.open(STATIC_CACHE)'))
  })

  it('la branche des pages conserve son propre contrôle', () => {
    expect(sw).toMatch(/res\.ok && !\/no-store\|private\/i\.test\(cc\)/)
  })

  it('l’API n’est JAMAIS mise en cache', () => {
    // Une réponse authentifiée en cache serait resservie à l'utilisateur suivant
    // du même appareil.
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api\/'\)\) return/)
  })

  it('le cache est versionné par release et les anciens sont purgés', () => {
    expect(sw).toMatch(/searchParams\.get\('v'\)/)
    expect(sw).toMatch(/keys\.filter\(\(k\) => !k\.startsWith\(VERSION\)\)/)
  })

  it('aucune activation forcée à l’installation', () => {
    // `skipWaiting()` à l'install prendrait le contrôle immédiatement et
    // rechargerait la page sans consentement — saisie en cours perdue.
    //
    // Les COMMENTAIRES sont retirés avant l'analyse : celui du gestionnaire
    // `install` explique justement pourquoi `skipWaiting()` n'y est pas, et le
    // faire échouer sur sa propre explication pousserait à appauvrir le
    // commentaire pour satisfaire le test. Même piège déjà rencontré ailleurs
    // dans ce dépôt.
    const propre = sw.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const install = propre.slice(
      propre.indexOf("addEventListener('install'"),
      propre.indexOf("addEventListener('activate'"),
    )
    expect(install).not.toMatch(/skipWaiting\(\)/)
    // …et l'activation forcée reste disponible SUR DEMANDE de l'utilisateur.
    expect(propre).toMatch(/event\.data === 'SKIP_WAITING'\) self\.skipWaiting\(\)/)
  })
})

describe('mise à jour PWA : une version prête est ANNONCÉE (GF-DUR-040)', () => {
  const reg = lire('src/components/PwaRegister.tsx')

  it('un worker déjà en attente au chargement est détecté', () => {
    expect(reg, 'updatefound ne rattrape pas un worker installé avant ce chargement')
      .toMatch(/reg\.waiting && navigator\.serviceWorker\.controller/)
    expect(reg).toMatch(/setUpdateReady\(reg\.waiting\)/)
  })

  it('l’arrivée d’un nouveau worker reste écoutée', () => {
    expect(reg).toMatch(/addEventListener\('updatefound'/)
    expect(reg).toMatch(/sw\.state === 'installed'/)
  })

  it('l’écouteur controllerchange est RETIRÉ au démontage', () => {
    // Il vit sur `navigator.serviceWorker`, pas sur le composant : ne pas le
    // retirer en empile un par montage, et un seul changement de contrôleur
    // déclenche alors plusieurs rechargements.
    expect(reg).toMatch(/removeEventListener\('controllerchange', onControllerChange\)/)
  })

  it('l’URL du worker porte la version — sinon aucune mise à jour n’est détectée', () => {
    expect(reg).toMatch(/\/sw\.js\?v=\$\{encodeURIComponent\(process\.env\.NEXT_PUBLIC_GF_VERSION/)
  })

  it('l’incompatibilité de contrat prime sur la simple mise à jour', () => {
    // Continuer à travailler avec une API dont le contrat a changé produirait
    // des écritures perdues sans que l'utilisateur le voie.
    expect(reg.indexOf('if (incompatible)')).toBeLessThan(reg.indexOf('if (!updateReady)'))
  })
})

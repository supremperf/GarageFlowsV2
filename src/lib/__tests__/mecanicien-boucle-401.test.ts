/**
 * GF-DUR-035 — une session mécanicien refusée par l'API ne doit pas boucler.
 *
 * ─── Le défaut, mesuré dans un vrai navigateur ──────────────────────────────
 * `mechFetch` envoie vers `/license` quand une route mécanicien répond 401.
 * `confineMechanic` renvoyait TOUT — y compris `/license` — vers `/mechanic`.
 * Composés :
 *
 *     /mechanic → GET /api/mechanic/me → 401
 *              → window.location = /license
 *              → middleware : cookie valide → redirection /mechanic
 *              → …
 *
 * Relevé sur `next start`, PWA ouverte 20 s avec une session que l'API refuse :
 *
 *     appels /api/ ............ 246 en 20,0 s  →  737 req/min
 *     écarts entre sondages ... ~140 ms (un aller-retour), au lieu des 3 s
 *                               annoncés par lib/live-sync
 *     statuts ................. 200×122, 401×118, 429×4
 *
 * ─── Pourquoi ce n'est pas un cas de laboratoire ────────────────────────────
 * `validateMechanicSession` répond 401, AVEC un cookie que le middleware
 * accepte (la signature est bonne), dès que :
 *   · la clé mécanicien est révoquée ou suspendue par le responsable,
 *   · elle expire,
 *   · elle est réattribuée à un autre mécanicien,
 *   · ou la licence GARAGE parente expire.
 * Ce sont des gestes normaux d'exploitation.
 *
 * ─── Ce que ça casse au-delà du téléphone ───────────────────────────────────
 * La limite de débit `api` est indexée sur l'IP (`enforceRateLimit('api',
 * clientIpFrom(req))`), à 120 req/min par défaut. Dans un garage, tous les
 * appareils sortent derrière la MÊME adresse. Un seul téléphone en boucle émet
 * ~740 req/min : il épuise le quota commun en quelques secondes, et le poste du
 * garage se met à recevoir des 429. Un mécanicien révoqué suffit à couper
 * l'accès API de tout l'atelier.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('la boucle /mechanic ↔ /license ne peut pas se reformer (GF-DUR-035)', () => {
  const middleware = lire('src/middleware.ts')
  const client = lire('src/lib/mechanic-client.ts')

  it('le confinement mécanicien laisse passer /license', () => {
    // C'est la destination de `mechFetch` sur 401 : la lui interdire enfermait
    // l'appareil dans un aller-retour sans fin.
    const bloc = middleware.slice(middleware.indexOf('function confineMechanic'))
    const corps = bloc.slice(0, bloc.indexOf('\n}'))
    expect(corps).toMatch(/pathname === '\/license'/)
    expect(corps).toMatch(/NextResponse\.next\(\)/)
  })

  it('le confinement reste sinon strict — /license est la SEULE sortie', () => {
    // Sans cela, corriger la boucle ouvrirait l'application au mécanicien.
    const bloc = middleware.slice(middleware.indexOf('function confineMechanic'))
    const corps = bloc.slice(0, bloc.indexOf('\n}'))
    expect(corps).toMatch(/redirectTo\(req, '\/mechanic'\)/)
    // Aucune autre page autorisée.
    const autorisees = Array.from(corps.matchAll(/pathname === '([^']+)'/g)).map((m) => m[1])
    expect(autorisees.sort()).toEqual(['/license', '/mechanic'])
  })

  it('un 401 EFFACE la session avant de rediriger', () => {
    // Le cookie reste cryptographiquement valide alors que l'API le refuse :
    // tant qu'il est présenté, la boucle peut se reformer. On demande donc au
    // serveur de le retirer.
    const bloc = client.slice(client.indexOf('res.status === 401'))
    expect(bloc).toMatch(/fetch\('\/api\/mechanic\/logout', \{ method: 'POST' \}\)/)
    // …et l'effacement précède la navigation.
    expect(bloc.indexOf('/api/mechanic/logout')).toBeLessThan(bloc.indexOf('window.location.href'))
  })

  it('deux 401 simultanés ne déclenchent qu’UNE redirection', () => {
    // Le profil et le planning partent en parallèle : sans verrou, chaque 401
    // lançait sa propre navigation et les deux se relançaient mutuellement.
    expect(client).toMatch(/let redirectionEnCours = false/)
    expect(client).toMatch(/if \(!redirectionEnCours\)/)
    expect(client).toMatch(/redirectionEnCours = true/)
  })
})

describe('la cadence annoncée est bien celle qui est appliquée', () => {
  it('la politique de sondage reste à 3 s, sans chemin plus rapide', () => {
    // La mesure a montré ~140 ms : l'écart ne venait pas de la politique mais
    // de la boucle de navigation. On verrouille quand même la valeur, pour que
    // la prochaine mesure ait une référence écrite.
    const sync = lire('src/lib/live-sync.ts')
    expect(sync).toMatch(/LIVE_BASE_INTERVAL_MS = 3_000/)
    expect(sync).toMatch(/LIVE_MAX_BACKOFF_MS = 30_000/)
  })

  it('la limite de débit `api` est bien indexée sur l’IP — et le commentaire le dit', () => {
    // Le commentaire annonçait « per authenticated user (by garageId) » alors
    // que le code passe `clientIpFrom(req)`. Dans un garage derrière un NAT,
    // TOUS les appareils partagent donc le quota. Ce n'est pas corrigé ici (le
    // changer modifierait la politique de sécurité), mais l'écart entre le
    // commentaire et le code est levé : il avait masqué l'ampleur de la boucle.
    //
    // On n'assertit PAS l'absence de l'ancienne phrase : le commentaire qui
    // corrige l'écart doit pouvoir la citer pour expliquer ce qui a été
    // rectifié. Faire échouer un test sur sa propre explication pousserait à
    // appauvrir le commentaire — la même erreur avait déjà été commise ailleurs
    // dans ce dépôt.
    const h = lire('src/lib/api-helpers.ts')
    expect(h).toMatch(/enforceRateLimit\('api', clientIpFrom\(req\)\)/)
    expect(h).toMatch(/par ADRESSE IP/)
  })
})
